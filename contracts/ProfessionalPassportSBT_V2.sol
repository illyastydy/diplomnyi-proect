// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProfessionalPassportSBT_V2
/// @notice Soulbound Web3 passport for reputation-based productivity stimulation.
contract ProfessionalPassportSBT_V2 is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    struct Reputation {
        uint256 totalPoints;
        uint256 tasksCompleted;
        uint256 reliabilityScore;
        uint256 currentStreak;
        uint256 lastUpdatedAt;
    }

    mapping(uint256 => Reputation) public employeeReputation;
    mapping(address => uint256) public passportOf;
    mapping(uint256 => bool) public passportExists;
    mapping(address => bool) public managers;

    event ManagerStatusChanged(address indexed manager, bool enabled);
    event PassportMinted(address indexed employee, uint256 indexed tokenId, string uri);
    event ReputationUpdated(
        uint256 indexed tokenId,
        uint256 addedPoints,
        uint256 totalPoints,
        uint256 tasksCompleted,
        uint256 reliabilityScore,
        uint256 currentStreak
    );

    modifier onlyManagerOrOwner() {
        require(owner() == msg.sender || managers[msg.sender], "Not authorized manager");
        _;
    }

    constructor(address initialOwner) ERC721("Web3 Professional Passport", "W3PP") Ownable(initialOwner) {}

    function setManager(address manager, bool enabled) external onlyOwner {
        managers[manager] = enabled;
        emit ManagerStatusChanged(manager, enabled);
    }

    function mintPassport(address employee, string memory uri) external onlyManagerOrOwner returns (uint256) {
        require(employee != address(0), "Invalid employee address");
        require(balanceOf(employee) == 0, "Employee already has a passport");

        uint256 tokenId = _nextTokenId++;
        _safeMint(employee, tokenId);
        _setTokenURI(tokenId, uri);

        passportOf[employee] = tokenId;
        passportExists[tokenId] = true;
        employeeReputation[tokenId] = Reputation({
            totalPoints: 0,
            tasksCompleted: 0,
            reliabilityScore: 100,
            currentStreak: 0,
            lastUpdatedAt: block.timestamp
        });

        emit PassportMinted(employee, tokenId, uri);
        return tokenId;
    }

    function updateReputation(
        uint256 tokenId,
        uint256 addedPoints,
        uint256 newReliabilityScore
    ) external onlyManagerOrOwner {
        require(passportExists[tokenId], "Passport does not exist");
        require(newReliabilityScore <= 100, "Reliability must be 0..100");

        Reputation storage rep = employeeReputation[tokenId];
        rep.totalPoints += addedPoints;
        rep.tasksCompleted += 1;
        rep.reliabilityScore = newReliabilityScore;
        rep.currentStreak = newReliabilityScore >= 80 ? rep.currentStreak + 1 : 0;
        rep.lastUpdatedAt = block.timestamp;

        emit ReputationUpdated(
            tokenId,
            addedPoints,
            rep.totalPoints,
            rep.tasksCompleted,
            rep.reliabilityScore,
            rep.currentStreak
        );
    }

    function getReputation(uint256 tokenId) external view returns (Reputation memory) {
        require(passportExists[tokenId], "Passport does not exist");
        return employeeReputation[tokenId];
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "Soulbound token: transfer locked");
        return super._update(to, tokenId, auth);
    }
}
