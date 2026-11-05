// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {ClutchHook} from "../src/clutch/ClutchHook.sol";
import {ClutchRouter} from "../src/clutch/ClutchRouter.sol";
import {HumanPassGate} from "../src/clutch/HumanPassGate.sol";
import {LPVault} from "../src/clutch/LPVault.sol";
import {SequencerGuard, ISequencerUptimeFeed} from "../src/blackout/SequencerGuard.sol";
import {BlackoutGuardHook} from "../src/blackout/BlackoutGuardHook.sol";
import {MockSequencerFeed} from "../src/blackout/MockSequencerFeed.sol";
import {MockUSDC, StreamToken} from "../src/mocks/Tokens.sol";

/// @notice Deploys the whole system and writes deployments/<chainId>.json for the engine and app.
/// Stream pools are created later by the engine (owner key) as channels and streamers come online.
///
/// Env:
///   PRIVATE_KEY            deployer / owner
///   AGENT_ADDRESS          engine + resolver role (the 0G agent's wallet)
///   PASS_SIGNER_ADDRESS    backend key that signs human passes after World ID verification
///   POOL_MANAGER           optional: existing v4 PoolManager (deploys a fresh one if unset)
///   SEQUENCER_FEED         optional: Chainlink L2 sequencer uptime feed (deploys MockSequencerFeed if unset)
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;

    // sqrt(2000e6 / 1e18) * 2^96 (ETH at 2,000 USDC)
    uint160 constant SQRT_PRICE_2000 = 3543191142285914205922034;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    struct Out {
        address poolManager;
        address usdc;
        address feed;
        address guard;
        address gate;
        address vault;
        address router;
        address clutchHook;
        address blackoutHook;
        address lpRouter;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        address passSigner = vm.envOr("PASS_SIGNER_ADDRESS", deployer);
        Out memory o;

        vm.startBroadcast(pk);

        o.poolManager = vm.envOr("POOL_MANAGER", address(0));
        if (o.poolManager == address(0)) o.poolManager = address(new PoolManager(deployer));
        IPoolManager manager = IPoolManager(o.poolManager);

        o.usdc = address(new MockUSDC());
        o.feed = vm.envOr("SEQUENCER_FEED", address(0));
        if (o.feed == address(0)) o.feed = address(new MockSequencerFeed());
        SequencerGuard guard = new SequencerGuard(ISequencerUptimeFeed(o.feed), 40, 1 hours);
        o.guard = address(guard);
        HumanPassGate gate = new HumanPassGate(passSigner, 500e6);
        o.gate = address(gate);
        LPVault vault = new LPVault(o.usdc);
        o.vault = address(vault);
        ClutchRouter router = new ClutchRouter(manager);
        o.router = address(router);

        // ClutchHook at a CREATE2 address whose low bits encode its permissions.
        {
            uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
            bytes memory args = abi.encode(manager, o.usdc, guard, deployer);
            (address expected, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(ClutchHook).creationCode, args);
            ClutchHook hook = new ClutchHook{salt: salt}(manager, o.usdc, guard, deployer);
            require(address(hook) == expected, "clutch hook address");
            o.clutchHook = address(hook);
        }
        {
            uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
            bytes memory args = abi.encode(manager, guard, uint24(3_000), uint24(150_000), uint24(250_000));
            (address expected, bytes32 salt) =
                HookMiner.find(CREATE2_FACTORY, flags, type(BlackoutGuardHook).creationCode, args);
            BlackoutGuardHook bg =
                new BlackoutGuardHook{salt: salt}(manager, guard, uint24(3_000), uint24(150_000), uint24(250_000));
            require(address(bg) == expected, "blackout hook address");
            o.blackoutHook = address(bg);
        }

        ClutchHook clutch = ClutchHook(o.clutchHook);
        clutch.configure(agent, agent, deployer, gate, vault);
        clutch.setTrustedRouter(o.router, true);
        gate.setHook(o.clutchHook);
        vault.setHook(o.clutchHook);

        // Seed the LP vault.
        MockUSDC(o.usdc).mint(deployer, 10_000_000e6);
        MockUSDC(o.usdc).approve(o.vault, type(uint256).max);
        vault.deposit(50_000e6, deployer);

        // The ETH/USDC top-up pool, protected by Blackout Guard.
        PoolKey memory ethKey = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(o.usdc), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(o.blackoutHook)
        );
        manager.initialize(ethKey, SQRT_PRICE_2000);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        o.lpRouter = address(lpRouter);
        MockUSDC(o.usdc).approve(o.lpRouter, type(uint256).max);
        uint256 ethForLiquidity = vm.envOr("ETH_LIQUIDITY_WEI", uint256(50 ether));
        lpRouter.modifyLiquidity{value: ethForLiquidity}(
            ethKey,
            ModifyLiquidityParams({
                tickLower: -887220,
                tickUpper: 887220,
                liquidityDelta: int256(ethForLiquidity * 98 / 100 * 4472135955 / 1e14),
                salt: 0
            }),
            ""
        );

        vm.stopBroadcast();

        _write(o, ethKey, agent, passSigner, deployer);
    }

    function _sorted(address a, address b, uint24 fee, int24 spacing, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), fee, spacing, IHooks(hook));
    }

    function _write(Out memory o, PoolKey memory ethKey, address agent, address passSigner, address owner) internal {
        string memory j = "deploy";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", block.number);
        vm.serializeAddress(j, "poolManager", o.poolManager);
        vm.serializeAddress(j, "usdc", o.usdc);
        vm.serializeAddress(j, "sequencerFeed", o.feed);
        vm.serializeAddress(j, "sequencerGuard", o.guard);
        vm.serializeAddress(j, "humanPassGate", o.gate);
        vm.serializeAddress(j, "lpVault", o.vault);
        vm.serializeAddress(j, "router", o.router);
        vm.serializeAddress(j, "clutchHook", o.clutchHook);
        vm.serializeAddress(j, "blackoutGuardHook", o.blackoutHook);
        vm.serializeAddress(j, "agent", agent);
        vm.serializeAddress(j, "passSigner", passSigner);
        vm.serializeAddress(j, "owner", owner);

        string memory e = "ethPool";
        vm.serializeAddress(e, "currency0", Currency.unwrap(ethKey.currency0));
        vm.serializeAddress(e, "currency1", Currency.unwrap(ethKey.currency1));
        vm.serializeUint(e, "fee", ethKey.fee);
        vm.serializeInt(e, "tickSpacing", ethKey.tickSpacing);
        string memory ethJson = vm.serializeBytes32(e, "poolId", PoolId.unwrap(ethKey.toId()));

        string memory out = vm.serializeString(j, "ethPool", ethJson);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
    }
}
