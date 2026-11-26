// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ILpFactory {
    function getPool(address token0, address token1, uint24 fee) external view returns (address);
}

interface ILpPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

interface ILpManager {
    struct Mint {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct Decrease {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct Collect {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    struct Position {
        uint96 nonce;
        address operator;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowth0;
        uint256 feeGrowth1;
        uint128 owed0;
        uint128 owed1;
    }
    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function positions(uint256 tokenId) external view returns (Position memory);
    function mint(Mint calldata p) external payable returns (uint256, uint128, uint256, uint256);
    function decreaseLiquidity(Decrease calldata p) external payable returns (uint256, uint256);
    function collect(Collect calldata p) external payable returns (uint256, uint256);
    function burn(uint256 tokenId) external payable;
}

/// @notice Owner-controlled, fork-only example for one fixed native USDC/WOKB V3 position.
contract ForkLiquidityAccount {
    ILpManager public constant manager = ILpManager(0x315e413A11AB0df498eF83873012430ca36638Ae);
    ILpFactory public constant factory = ILpFactory(0x4B2ab38DBF28D31D467aA8993f6c2585981D6804);
    ILpPool public constant pool = ILpPool(0x9f73888Fb725A3409548BC8d2e42365AC063E148);
    IERC20Metadata public constant usdc = IERC20Metadata(0xB6CEceAB302E2E4948951eE7843FC24E92933061);
    IERC20Metadata public constant wokb = IERC20Metadata(0xe538905cf8410324e03A5A23C1c177a474D59b2b);
    int24 public constant LOWER = 231630;
    int24 public constant UPPER = 232830;
    // Uniswap V3 TickMath.getSqrtRatioAtTick for the fixed boundaries, in Q64.96.
    uint160 private constant A = 8480269488078033598680571283421593;
    uint160 private constant B = 9004633054855875436865350762538812;
    address public immutable owner;
    uint256 public tokenId;
    bool private entered;

    error ForkOnly();
    error OwnerOnly();
    error Identity();
    error Bounds();
    error ClosedOrOccupied();
    error Settlement();
    event Opened(uint256 indexed id, uint128 liquidity, uint256 usdcIn, uint256 wokbIn);
    event FeesCollected(uint256 indexed id, uint256 usdcFees, uint256 wokbFees);
    event Closed(
        uint256 indexed id, uint256 usdcPrincipal, uint256 wokbPrincipal, uint256 usdcReceived, uint256 wokbReceived
    );
    event Withdrawn(address indexed asset, uint256 amount);

    modifier ownerAction() {
        if (msg.sender != owner) revert OwnerOnly();
        if (entered) revert Settlement();
        entered = true;
        _;
        entered = false;
    }

    constructor() {
        if (block.chainid != 31337) revert ForkOnly();
        owner = msg.sender;
        _pins();
        if (
            manager.factory() != address(factory) || manager.WETH9() != address(wokb)
                || factory.getPool(address(usdc), address(wokb), 500) != address(pool)
                || pool.factory() != address(factory) || pool.token0() != address(usdc)
                || pool.token1() != address(wokb) || pool.fee() != 500 || pool.tickSpacing() != 10
                || usdc.decimals() != 6 || wokb.decimals() != 18
        ) revert Identity();
    }

    function _pins() private view {
        if (
            address(manager).codehash != 0xd8339465f5c45afef4319fde20bb35cb5c5e17cf861c73b669d07ca615e3213c
                || address(factory).codehash != 0x98cde3564f540d7529feb2c697e2d79b85e3bc864d088ebe09fd5dcfc60a5c0e
                || address(pool).codehash != 0x0638025baf2d03329bad2146cc46a54850d42e665b400c64ae59f1637d82186d
                || address(usdc).codehash != 0xa259d230afe44e97f1500ce5c06cd2e5bdafb129f25c104d8716470cb4fff0be
                || address(wokb).codehash != 0xde187307e119db7066ef4d8d154ba1617313e4c9a410c70378abe475cd2cffd2
        ) revert Identity();
    }

    function _deadline(uint256 deadline) private view {
        if (deadline < block.timestamp || deadline > block.timestamp + 10 minutes) revert Bounds();
    }

    function _approve(IERC20Metadata asset, uint256 amount) private {
        if (!asset.approve(address(manager), amount) || asset.allowance(address(this), address(manager)) != amount) {
            revert Settlement();
        }
    }

    function position() public view returns (uint256 id, ILpManager.Position memory p) {
        _pins();
        id = tokenId;
        if (id == 0) revert ClosedOrOccupied();
        if (manager.ownerOf(id) != address(this)) revert Identity();
        p = manager.positions(id);
        if (
            p.operator != address(0) || p.token0 != address(usdc) || p.token1 != address(wokb) || p.fee != 500
                || p.tickLower != LOWER || p.tickUpper != UPPER || p.liquidity == 0
        ) revert Identity();
    }

    function open(uint256 max0, uint256 max1, uint256 min0, uint256 min1, uint256 deadline) external ownerAction {
        if (tokenId != 0) revert ClosedOrOccupied();
        _deadline(deadline);
        _pins();
        if (
            max0 == 0 || max1 == 0 || max0 > 250e6 || max1 > 3 ether || min0 > max0 || min1 > max1
                || 100 * min0 < 99 * max0 || 100 * min1 < 99 * max1
        ) revert Bounds();
        uint256 balance0 = usdc.balanceOf(address(this));
        uint256 balance1 = wokb.balanceOf(address(this));
        _approve(usdc, max0);
        _approve(wokb, max1);
        (uint256 id, uint128 liquidity, uint256 used0, uint256 used1) = manager.mint(
            ILpManager.Mint(
                address(usdc), address(wokb), 500, LOWER, UPPER, max0, max1, min0, min1, address(this), deadline
            )
        );
        _approve(usdc, 0);
        _approve(wokb, 0);
        tokenId = id;
        (, ILpManager.Position memory p) = position();
        if (
            p.liquidity != liquidity || used0 < min0 || used1 < min1 || used0 > max0 || used1 > max1
                || balance0 - usdc.balanceOf(address(this)) != used0
                || balance1 - wokb.balanceOf(address(this)) != used1
        ) revert Settlement();
        emit Opened(id, liquidity, used0, used1);
    }

    function _collect(uint256 id) private returns (uint256 out0, uint256 out1) {
        uint256 balance0 = usdc.balanceOf(address(this));
        uint256 balance1 = wokb.balanceOf(address(this));
        (out0, out1) = manager.collect(ILpManager.Collect(id, address(this), type(uint128).max, type(uint128).max));
        if (usdc.balanceOf(address(this)) - balance0 != out0 || wokb.balanceOf(address(this)) - balance1 != out1) {
            revert Settlement();
        }
    }

    function collectFees() external ownerAction {
        (uint256 id,) = position();
        (uint256 out0, uint256 out1) = _collect(id);
        emit FeesCollected(id, out0, out1);
    }

    function previewPrincipal() public view returns (uint256 amount0, uint256 amount1) {
        (, ILpManager.Position memory p) = position();
        (uint160 price,,,,,,) = pool.slot0();
        uint160 within = price < A ? A : price > B ? B : price;
        amount0 = Math.mulDiv(uint256(p.liquidity) << 96, B - within, B) / within;
        amount1 = Math.mulDiv(p.liquidity, within - A, 1 << 96);
    }

    function close(uint256 min0, uint256 min1, uint256 deadline) external ownerAction {
        _deadline(deadline);
        (uint256 id, ILpManager.Position memory p) = position();
        (uint256 quote0, uint256 quote1) = previewPrincipal();
        // Exits remain possible outside the range, including an entirely one-sided position.
        if (min0 < quote0 - quote0 / 100 || min1 < quote1 - quote1 / 100 || (min0 == 0 && min1 == 0)) revert Bounds();
        (uint256 principal0, uint256 principal1) =
            manager.decreaseLiquidity(ILpManager.Decrease(id, p.liquidity, min0, min1, deadline));
        (uint256 out0, uint256 out1) = _collect(id);
        if (out0 < min0 || out1 < min1) revert Settlement();
        manager.burn(id);
        tokenId = 0;
        emit Closed(id, principal0, principal1, out0, out1);
    }

    function withdraw(address token, uint256 amount) external ownerAction {
        if ((token != address(usdc) && token != address(wokb)) || amount == 0) revert Bounds();
        IERC20Metadata asset = IERC20Metadata(token);
        uint256 beforeOwner = asset.balanceOf(owner);
        uint256 beforeAccount = asset.balanceOf(address(this));
        if (
            !asset.transfer(owner, amount) || asset.balanceOf(owner) - beforeOwner != amount
                || beforeAccount - asset.balanceOf(address(this)) != amount
        ) revert Settlement();
        emit Withdrawn(token, amount);
    }
}
