pragma solidity =0.5.16;

import '../SomniaExchangeERC20.sol';

contract ERC20 is SomniaExchangeERC20 {
    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
