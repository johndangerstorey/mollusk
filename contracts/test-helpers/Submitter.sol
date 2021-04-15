// helper for testing mollusk.submitProposal return value

pragma solidity 0.5.3;

import "../Mollusk.sol";

contract Submitter {

  event Submit(uint256 proposalId);

  Mollusk public mollusk; // mollusk contract reference

  constructor(address molluskAddress) public {
    mollusk = Mollusk(molluskAddress);
  }

  function submitProposal(
    address applicant,
    uint256 sharesRequested,
    uint256 lootRequested,
    uint256 tributeOffered,
    address tributeToken,
    uint256 paymentRequested,
    address paymentToken,
    string memory details
  ) public {
    uint256 proposalId = mollusk.submitProposal(
      applicant,
      sharesRequested,
      lootRequested,
      tributeOffered,
      tributeToken,
      paymentRequested,
      paymentToken,
      details
    );

    emit Submit(proposalId);
  }

  function submitWhitelistProposal(
    address tokenToWhitelist,
    string memory details
  ) public {
    uint256 proposalId = mollusk.submitWhitelistProposal(
      tokenToWhitelist,
      details
    );

    emit Submit(proposalId);
  }

  function submitGuildKickProposal(
    address memberToKick,
    string memory details
  ) public {
    uint256 proposalId = mollusk.submitGuildKickProposal(
      memberToKick,
      details
    );

    emit Submit(proposalId);
  }
}
