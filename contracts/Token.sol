// SPDX-License-Identifier: MIT
pragma solidity ^0.5.16;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";

contract Token is ERC20Detailed, ERC20Mintable {
    uint256 public constant TOTAL_SUPPLY = 144_000_000_000 * (10 ** 18); // 144B token, 18 desimal

    constructor(
        string memory _name,
        string memory _symbol
    ) public ERC20Detailed(_name, _symbol, 18) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    function mintTokens() public {
        // Kullanıcıya belirli bir miktarda ek token mint'leyebilir
        _mint(msg.sender, 5 ether);
    }
}
