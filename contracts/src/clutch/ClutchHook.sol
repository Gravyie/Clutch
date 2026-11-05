// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

import {LMSR} from "./LMSR.sol";
import {SequencerGuard} from "../blackout/SequencerGuard.sol";
import {IClutchGate, ISubsidyVault} from "../interfaces/IClutch.sol";

/// @title ClutchHook
/// @notice Short binary prediction markets on live moments, running inside a Uniswap v4 pool.
///
/// One pool per stream (USDC / StreamToken). Each market is an id in this hook's storage, so back-to-back rounds
/// reuse the same pool. The hook replaces the pool's curve with LMSR via `beforeSwap` + `beforeSwapReturnDelta`:
/// it takes the trader's USDC, prices YES/NO shares on the LMSR curve, and records them against the trader. The
/// concentrated-liquidity swap is a no-op; no liquidity is ever added to these pools. Stakes are held as the
/// PoolManager's ERC-6909 USDC claims and redeemed only when someone is paid.
///
/// Integrity rules enforced here, not in the app:
///  1. Forward-only windows: a market's event window must start at or after lock + the stream's latency buffer.
///  2. Person-level admission: every trade passes the gate (World ID pass, caps, exclusion, streamer bar).
///  3. Blackout-aware: no trading or opening unless the shared SequencerGuard reports Normal, and any market whose
///     trading period overlapped a sequencer outage is voided at resolution (catch-up blocks can be back-dated).
///  4. Bounded loss: the vault funds each market's exact LMSR worst case before it opens.
///  5. Void means refund at cost, including fees.
contract ClutchHook is BaseHook, IUnlockCallback {
    using SafeTransferLib for address;
    using PoolIdLibrary for PoolKey;

    enum Status {
        None,
        Open,
        Resolved
    }

    enum Outcome {
        None,
        Yes,
        No,
        Void
    }

    struct Stream {
        bool registered;
        bool paused;
        bool usdcIs0;
        uint32 latencyBuffer; // seconds; the slowest viewer sees the lock at most this long after it happens
        address streamer; // payout address for the streamer's share of fees; may pause the stream
        uint256 streamerNullifier; // World ID nullifier of the streamer, barred from trading here
        uint256 liveMarket;
        uint256 volume;
    }

    struct Market {
        PoolId poolId;
        bytes32 ruleHash; // keccak256 of the canonical rule JSON, committed before any trade
        bytes32 evidenceRoot; // 0G Storage root of the evidence bundle, posted at resolution
        int256 qYes; // LMSR state (wad)
        int256 qNo;
        int256 b; // LMSR liquidity (wad)
        uint64 pYes0; // opening probability (wad, fits in 64 bits)
        uint64 openedAt;
        uint64 lockTime;
        uint64 windowStart;
        uint64 windowEnd;
        uint128 subsidy; // USDC drawn from the vault
        uint128 collected; // USDC paid into the curve (net of fees)
        uint128 fees; // USDC fees, held until resolution so a void can refund them
        uint128 sharesYes; // shares issued to traders (USDC units)
        uint128 sharesNo;
        Status status;
        Outcome outcome;
    }

    struct Position {
        uint128 yes;
        uint128 no;
        uint128 cost; // USDC paid including fees: the refund on void
        bool claimed;
    }

    uint256 internal constant WAD_PER_USDC = 1e12;
    /// @dev Shaved from every fill (in wad) so fixed-point error can only favour the pot.
    int256 internal constant FILL_EPSILON = 1e12;
    uint64 public constant MIN_P = 0.15e18;
    uint64 public constant MAX_P = 0.85e18;
    uint32 public constant MIN_LATENCY_BUFFER = 5;

    address public immutable usdc;
    SequencerGuard public immutable guard;

    address public owner;
    address public engine;
    address public resolver;
    address public treasury;
    IClutchGate public gate;
    ISubsidyVault public vault;

    uint16 public feeBps = 200; // 2% of each stake
    uint16 public lpShareBps = 5_000; // of fees: 1% of volume to LPs
    uint16 public streamerShareBps = 2_500; // 0.5% to the streamer
    uint16 public resolverShareBps = 1_250; // 0.25% to the resolver agent; the rest to the protocol
    uint64 public resolveTimeout = 1 hours;

    mapping(address => bool) public trustedRouter;
    mapping(PoolId => Stream) public streams;
    Market[] internal _markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256) public owed;

    event StreamRegistered(PoolId indexed poolId, address streamer, uint256 streamerNullifier, uint32 latencyBuffer);
    event LatencyBufferSet(PoolId indexed poolId, uint32 latencyBuffer);
    event StreamPaused(PoolId indexed poolId, bool paused);
    event MarketOpened(
        uint256 indexed id,
        PoolId indexed poolId,
        bytes32 ruleHash,
        uint64 lockTime,
        uint64 windowStart,
        uint64 windowEnd,
        uint256 b,
        uint64 pYes,
        uint256 subsidy
    );
    event Backed(
        uint256 indexed id,
        address indexed trader,
        uint256 indexed nullifier,
        bool yes,
        uint256 amountIn,
        uint256 shares,
        uint256 priceYesAfter
    );
    event MarketResolved(uint256 indexed id, Outcome outcome, bytes32 evidenceRoot, uint256 returnedToVault);
    event BlackoutVoid(uint256 indexed id);
    event Claimed(uint256 indexed id, address indexed trader, uint256 amount);

    error NotOwner();
    error NotEngine();
    error NotResolver();
    error NotStreamerOrOwner();
    error UntrustedRouter();
    error UnknownStream();
    error StreamIsPaused();
    error NotUsdcPool();
    error ExactInputOnly();
    error PayInUsdcOnly();
    error AmountTooLarge();
    error NoLiquidityHere();
    error MarketNotOpen();
    error MarketLocked();
    error MarketStillLive(uint256 id);
    error NotUncertain(uint64 pYes);
    error LockInPast();
    error WindowNotForward(uint64 windowStart, uint64 earliestAllowed);
    error BadWindow();
    error BufferTooSmall();
    error ChainNotNormal(SequencerGuard.Phase phase);
    error WindowNotStarted();
    error BadOutcome();
    error NotExpired();
    error AlreadyClaimed();
    error NothingToClaim();
    error Slippage(uint256 shares, uint256 minShares);

    /// @param _owner Passed explicitly because the hook is deployed through a CREATE2 factory.
    constructor(IPoolManager _poolManager, address _usdc, SequencerGuard _guard, address _owner) BaseHook(_poolManager) {
        usdc = _usdc;
        guard = _guard;
        owner = _owner;
        treasury = _owner;
    }

    // ─── Permissions ─────────────────────────────────────────────────────────────────────────────

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────────────────────

    function configure(address _engine, address _resolver, address _treasury, IClutchGate _gate, ISubsidyVault _vault)
        external
        onlyOwner
    {
        engine = _engine;
        resolver = _resolver;
        treasury = _treasury;
        gate = _gate;
        vault = _vault;
    }

    function setTrustedRouter(address router, bool trusted) external onlyOwner {
        trustedRouter[router] = trusted;
    }

    function registerStream(PoolKey calldata key, address streamer, uint256 streamerNullifier, uint32 latencyBuffer)
        external
        onlyOwner
    {
        if (address(key.hooks) != address(this)) revert UnknownStream();
        bool usdcIs0 = Currency.unwrap(key.currency0) == usdc;
        if (!usdcIs0 && Currency.unwrap(key.currency1) != usdc) revert NotUsdcPool();
        if (latencyBuffer < MIN_LATENCY_BUFFER) revert BufferTooSmall();
        PoolId id = key.toId();
        Stream storage st = streams[id];
        st.registered = true;
        st.usdcIs0 = usdcIs0;
        st.streamer = streamer;
        st.streamerNullifier = streamerNullifier;
        st.latencyBuffer = latencyBuffer;
        emit StreamRegistered(id, streamer, streamerNullifier, latencyBuffer);
    }

    /// @notice The engine raises or lowers the buffer as it measures the stream's real delay. Applies to new markets.
    function setLatencyBuffer(PoolId id, uint32 latencyBuffer) external {
        if (msg.sender != engine && msg.sender != owner) revert NotEngine();
        if (latencyBuffer < MIN_LATENCY_BUFFER) revert BufferTooSmall();
        streams[id].latencyBuffer = latencyBuffer;
        emit LatencyBufferSet(id, latencyBuffer);
    }

    /// @notice Streamer's kill switch: no new markets and no new trades while paused.
    function setPaused(PoolId id, bool paused) external {
        Stream storage st = streams[id];
        if (msg.sender != st.streamer && msg.sender != owner) revert NotStreamerOrOwner();
        st.paused = paused;
        emit StreamPaused(id, paused);
    }

    // ─── Market lifecycle ────────────────────────────────────────────────────────────────────────

    /// @notice Open a market. Called by the moment engine after it has chosen a template and an opening price.
    function openMarket(
        PoolId poolId,
        bytes32 ruleHash,
        uint64 lockTime,
        uint64 windowStart,
        uint64 windowEnd,
        uint128 b,
        uint64 pYes
    ) external returns (uint256 id) {
        if (msg.sender != engine) revert NotEngine();
        Stream storage st = streams[poolId];
        if (!st.registered) revert UnknownStream();
        if (st.paused) revert StreamIsPaused();
        if (st.liveMarket != 0) {
            Market storage live = _markets[st.liveMarket - 1];
            if (live.status == Status.Open && live.lockTime > block.timestamp) revert MarketStillLive(st.liveMarket);
        }
        if (pYes < MIN_P || pYes > MAX_P) revert NotUncertain(pYes);
        if (lockTime <= block.timestamp) revert LockInPast();

        // The forward-only rule: the event window starts only after the slowest viewer has seen trading close.
        if (windowStart < lockTime + st.latencyBuffer) revert WindowNotForward(windowStart, lockTime + st.latencyBuffer);

        if (windowEnd <= windowStart) revert BadWindow();
        _requireNormal();

        int256 bW = int256(uint256(b)) * int256(WAD_PER_USDC);
        int256 qYes0 = LMSR.initialYes(int256(uint256(pYes)), bW);
        uint256 subsidy = uint256(LMSR.maxLoss(int256(uint256(pYes)), bW)) / WAD_PER_USDC + 1;
        vault.fund(subsidy);

        _markets.push();
        id = _markets.length;
        Market storage m = _markets[id - 1];
        m.poolId = poolId;
        m.ruleHash = ruleHash;
        m.qYes = qYes0;
        m.b = bW;
        m.pYes0 = pYes;
        m.openedAt = uint64(block.timestamp);
        m.lockTime = lockTime;
        m.windowStart = windowStart;
        m.windowEnd = windowEnd;
        m.subsidy = uint128(subsidy);
        m.status = Status.Open;
        st.liveMarket = id;

        emit MarketOpened(id, poolId, ruleHash, lockTime, windowStart, windowEnd, b, pYes, subsidy);
    }

    /// @notice Post a verdict. YES/NO only when both sources agreed; the resolver posts VOID otherwise.
    function resolve(uint256 id, Outcome outcome, bytes32 evidenceRoot) external {
        if (msg.sender != resolver) revert NotResolver();
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketNotOpen();
        if (outcome == Outcome.None) revert BadOutcome();
        if (outcome != Outcome.Void) {
            if (block.timestamp < m.windowStart) revert WindowNotStarted();
            _requireNormal();
            if (guard.outageOverlaps(m.openedAt, m.lockTime)) {
                outcome = Outcome.Void;
                emit BlackoutVoid(id);
            }
        }
        _settle(id, m, outcome, evidenceRoot);
    }

    /// @notice Liveness: if the resolver goes silent, anyone can void a stale market and unlock refunds.
    function expire(uint256 id) external {
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp <= uint256(m.windowEnd) + resolveTimeout) revert NotExpired();
        _settle(id, m, Outcome.Void, bytes32(0));
    }

    /// @notice Pay out a trader's winnings (or refund on void). Anyone may trigger it; funds go to the trader.
    function claim(uint256 id, address trader) external returns (uint256 amount) {
        Market storage m = _market(id);
        if (m.status != Status.Resolved) revert MarketNotOpen();
        Position storage p = positions[id][trader];
        if (p.claimed) revert AlreadyClaimed();
        if (m.outcome == Outcome.Void) amount = p.cost;
        else amount = m.outcome == Outcome.Yes ? p.yes : p.no;
        if (amount == 0) revert NothingToClaim();
        p.claimed = true;
        _pay(trader, amount);
        emit Claimed(id, trader, amount);
    }

    function withdrawOwed() external {
        uint256 amount = owed[msg.sender];
        owed[msg.sender] = 0;
        _pay(msg.sender, amount);
    }

    // ─── Hook callbacks ──────────────────────────────────────────────────────────────────────────

    function _beforeInitialize(address sender, PoolKey calldata, uint160) internal view override returns (bytes4) {
        if (sender != owner) revert NotOwner();
        return this.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4)
    {
        revert NoLiquidityHere();
    }

    /// @dev hookData = abi.encode(uint256 marketId, bool yes, uint128 minShares, address trader, bytes gateData).
    /// Only trusted routers may call, because the trader is taken from hookData.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!trustedRouter[sender]) revert UntrustedRouter();
        PoolId poolId = key.toId();
        Stream storage st = streams[poolId];
        if (!st.registered) revert UnknownStream();
        if (params.amountSpecified >= 0) revert ExactInputOnly();
        if (params.zeroForOne != st.usdcIs0) revert PayInUsdcOnly();
        if (params.amountSpecified < type(int128).min) revert AmountTooLarge();

        uint256 amountIn = uint256(-params.amountSpecified);
        uint256 shares = _back(st, poolId, amountIn, hookData);
        _setLastFill(shares);

        // Consume the whole input so the CL swap is a no-op, and hold it as ERC-6909 claims. (The router settles the
        // trader's USDC after this callback, so the PoolManager can't pay out real tokens yet.)
        poolManager.mint(address(this), _usdcId(), amountIn);
        return (this.beforeSwap.selector, toBeforeSwapDelta(int128(-params.amountSpecified), 0), 0);
    }

    function _back(Stream storage st, PoolId poolId, uint256 amountIn, bytes calldata hookData)
        internal
        returns (uint256 shares)
    {
        (uint256 id, bool yes, uint128 minShares, address trader, bytes memory gateData) =
            abi.decode(hookData, (uint256, bool, uint128, address, bytes));
        Market storage m = _market(id);
        if (m.status != Status.Open || PoolId.unwrap(m.poolId) != PoolId.unwrap(poolId)) revert MarketNotOpen();
        if (block.timestamp >= m.lockTime) revert MarketLocked();
        if (st.paused) revert StreamIsPaused();
        _requireNormal();

        uint256 nullifier = gate.admit(trader, amountIn, st.streamerNullifier, gateData);

        uint256 fee = amountIn * feeBps / 10_000;
        uint256 net = amountIn - fee;
        int256 netW = int256(net * WAD_PER_USDC);
        int256 sharesW;
        if (yes) {
            sharesW = LMSR.sharesForCost(m.qYes, m.qNo, m.b, netW);
            m.qYes += sharesW;
        } else {
            sharesW = LMSR.sharesForCost(m.qNo, m.qYes, m.b, netW);
            m.qNo += sharesW;
        }
        // The curve state moves by the exact amount; the trader receives the floor, so rounding favours the pot.
        shares = sharesW > FILL_EPSILON ? uint256(sharesW - FILL_EPSILON) / WAD_PER_USDC : 0;
        if (shares == 0 || shares < minShares) revert Slippage(shares, minShares);

        Position storage p = positions[id][trader];
        if (yes) {
            p.yes += uint128(shares);
            m.sharesYes += uint128(shares);
        } else {
            p.no += uint128(shares);
            m.sharesNo += uint128(shares);
        }
        p.cost += uint128(amountIn);
        m.collected += uint128(net);
        m.fees += uint128(fee);
        st.volume += amountIn;

        emit Backed(id, trader, nullifier, yes, amountIn, shares, uint256(LMSR.priceYes(m.qYes, m.qNo, m.b)));
    }

    // ─── Internals ───────────────────────────────────────────────────────────────────────────────

    function _settle(uint256 id, Market storage m, Outcome outcome, bytes32 evidenceRoot) internal {
        m.status = Status.Resolved;
        m.outcome = outcome;
        m.evidenceRoot = evidenceRoot;
        Stream storage st = streams[m.poolId];
        if (st.liveMarket == id) st.liveMarket = 0;

        uint256 returned;
        if (outcome == Outcome.Void) {
            // Stakes and fees stay here for refunds at cost; the subsidy goes home untouched.
            returned = m.subsidy;
        } else {
            uint256 winning = outcome == Outcome.Yes ? m.sharesYes : m.sharesNo;
            // LMSR guarantees collected + subsidy >= winning shares; see LMSR.sol. Underflow here would revert.
            uint256 leftover = uint256(m.collected) + m.subsidy - winning;
            uint256 lpFee = uint256(m.fees) * lpShareBps / 10_000;
            uint256 streamerFee = uint256(m.fees) * streamerShareBps / 10_000;
            uint256 resolverFee = uint256(m.fees) * resolverShareBps / 10_000;
            owed[st.streamer] += streamerFee;
            owed[resolver] += resolverFee;
            owed[treasury] += m.fees - lpFee - streamerFee - resolverFee;
            returned = leftover + lpFee;
        }
        _pay(address(vault), returned);
        vault.settle(m.subsidy, returned);
        emit MarketResolved(id, outcome, evidenceRoot, returned);
    }

    /// @dev Pay from ERC-6909 claims first (redeemed through an unlock), then from USDC held directly.
    function _pay(address to, uint256 amount) internal {
        uint256 claims = poolManager.balanceOf(address(this), _usdcId());
        uint256 fromClaims = amount < claims ? amount : claims;
        if (fromClaims > 0) poolManager.unlock(abi.encode(to, fromClaims));
        if (amount > fromClaims) usdc.safeTransfer(to, amount - fromClaims);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address to, uint256 amount) = abi.decode(data, (address, uint256));
        poolManager.burn(address(this), _usdcId(), amount);
        poolManager.take(Currency.wrap(usdc), to, amount);
        return "";
    }

    function _usdcId() internal view returns (uint256) {
        return uint256(uint160(usdc));
    }

    /// @notice USDC this hook controls: direct balance plus PoolManager claims.
    function heldUsdc() external view returns (uint256) {
        return usdc.balanceOf(address(this)) + poolManager.balanceOf(address(this), _usdcId());
    }

    function _requireNormal() internal {
        (SequencerGuard.Phase phase,) = guard.observe();
        if (phase != SequencerGuard.Phase.Normal) revert ChainNotNormal(phase);
    }

    function _market(uint256 id) internal view returns (Market storage) {
        if (id == 0 || id > _markets.length) revert MarketNotOpen();
        return _markets[id - 1];
    }

    /// @dev Transient slot so the router can return the fill without parsing events.
    bytes32 internal constant LAST_FILL_SLOT = keccak256("clutch.lastFill");

    function _setLastFill(uint256 shares) internal {
        bytes32 slot = LAST_FILL_SLOT;
        assembly ("memory-safe") {
            tstore(slot, shares)
        }
    }

    function lastFill() external view returns (uint256 shares) {
        bytes32 slot = LAST_FILL_SLOT;
        assembly ("memory-safe") {
            shares := tload(slot)
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────────────────────────────

    function market(uint256 id) external view returns (Market memory) {
        return _market(id);
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function priceYes(uint256 id) external view returns (uint256) {
        Market storage m = _market(id);
        return uint256(LMSR.priceYes(m.qYes, m.qNo, m.b));
    }

    /// @notice Shares `amountIn` USDC would buy right now (before gate checks).
    function quote(uint256 id, bool yes, uint256 amountIn) external view returns (uint256 shares, uint256 priceYesAfter) {
        Market storage m = _market(id);
        uint256 net = amountIn - amountIn * feeBps / 10_000;
        int256 netW = int256(net * WAD_PER_USDC);
        int256 sharesW;
        int256 qy = m.qYes;
        int256 qn = m.qNo;
        if (yes) {
            sharesW = LMSR.sharesForCost(qy, qn, m.b, netW);
            qy += sharesW;
        } else {
            sharesW = LMSR.sharesForCost(qn, qy, m.b, netW);
            qn += sharesW;
        }
        shares = sharesW > FILL_EPSILON ? uint256(sharesW - FILL_EPSILON) / WAD_PER_USDC : 0;
        priceYesAfter = uint256(LMSR.priceYes(qy, qn, m.b));
    }
}
