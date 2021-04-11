pragma solidity 0.5.3;

import "./Mollusk.sol";

contract MolluskSummoner {

    Mollusk private M;

    address[] public Mollusks;

    event Summoned(address indexed M, address indexed _summoner);

    function summonMollusk(
        address _summoner,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward) public {

        M = new Mollusk(
            _summoner,
            _approvedTokens,
            _periodDuration,
            _votingPeriodLength,
            _gracePeriodLength,
            _proposalDeposit,
            _dilutionBound,
            _processingReward);

        Mollusks.push(address(M));

        emit Summoned(address(M), _summoner);

    }

    function getMolluskCount() public view returns (uint256 MolluskCount) {
        return Mollusks.length;
    }
}
