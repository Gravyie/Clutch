// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";

/// @title LMSR
/// @notice Binary logarithmic market scoring rule in signed 18-decimal fixed point.
///
///   C(qy, qn)  = b · ln(e^(qy/b) + e^(qn/b))
///   price(YES) = 1 / (1 + e^((qn − qy)/b))
///
/// One share pays 1 unit of collateral if its outcome wins. A market opened at probability p starts at
/// qy0 = b·ln(p/(1−p)), qn0 = 0, so its worst-case loss is C(q0) − min(qy0, qn0) = b·ln(1 / min(p, 1−p)).
/// At p = 0.5 that is the textbook b·ln 2.
library LMSR {
    int256 internal constant WAD = 1e18;
    /// @dev Above this, ln(e^d − 1) = d − ln(1/(1−e^−d)) differs from d by < 5e−18; skip exp to avoid overflow.
    int256 internal constant LARGE_D = 40e18;

    error BadProbability();
    error BadLiquidity();

    function cost(int256 qy, int256 qn, int256 b) internal pure returns (int256) {
        int256 m = qy > qn ? qy : qn;
        int256 sum = M.expWad(M.sDivWad(qy - m, b)) + M.expWad(M.sDivWad(qn - m, b));
        return m + M.sMulWad(b, M.lnWad(sum));
    }

    function priceYes(int256 qy, int256 qn, int256 b) internal pure returns (int256) {
        return M.sDivWad(WAD, WAD + M.expWad(M.sDivWad(qn - qy, b)));
    }

    /// @notice Starting YES quantity for an opening probability `p` (with qn0 = 0).
    function initialYes(int256 p, int256 b) internal pure returns (int256) {
        if (p <= 0 || p >= WAD) revert BadProbability();
        if (b <= 0) revert BadLiquidity();
        return M.sMulWad(b, M.lnWad(M.sDivWad(p, WAD - p)));
    }

    /// @notice Worst-case subsidy needed for a market opened at probability `p`.
    function maxLoss(int256 p, int256 b) internal pure returns (int256) {
        int256 pMin = p < WAD - p ? p : WAD - p;
        return M.sMulWad(b, M.lnWad(M.sDivWad(WAD, pMin)));
    }

    /// @notice Shares of the `qBuy` outcome that exactly `x` collateral buys.
    /// @dev Closed form: C(qBuy', qOther) = C + x  ⇒  qBuy' = qOther + b·ln(e^((C + x − qOther)/b) − 1).
    function sharesForCost(int256 qBuy, int256 qOther, int256 b, int256 x) internal pure returns (int256) {
        int256 d = M.sDivWad(cost(qBuy, qOther, b) + x - qOther, b); // > 0 always, since C > qOther
        int256 lnTerm = d > LARGE_D ? d : M.lnWad(M.expWad(d) - WAD);
        return qOther + M.sMulWad(b, lnTerm) - qBuy;
    }
}
