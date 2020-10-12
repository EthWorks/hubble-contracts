pragma solidity ^0.5.15;
pragma experimental ABIEncoderV2;
import { FraudProofHelpers } from "./libs/FraudProofHelpers.sol";
import { Types } from "./libs/Types.sol";
import { MerkleTreeUtilsLib } from "./MerkleTreeUtils.sol";
import { BLS } from "./libs/BLS.sol";
import { Tx } from "./libs/Tx.sol";
import { MerkleTreeUtilsLib } from "./MerkleTreeUtils.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

contract Create2Transfer {
    using Tx for bytes;
    using Types for Types.UserState;
    using SafeMath for uint256;

    function checkSignature(
        uint256[2] memory signature,
        Types.SignatureProofWithReceiver memory proof,
        bytes32 stateRoot,
        bytes32 accountRoot,
        bytes32 domain,
        bytes memory txs
    ) public view returns (Types.Result) {
        uint256 batchSize = txs.create2Transfer_size();
        uint256[2][] memory messages = new uint256[2][](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            Tx.Create2Transfer memory _tx = txs.create2Transfer_decode(i);

            // check state inclustion
            require(
                MerkleTreeUtilsLib.verifyLeaf(
                    stateRoot,
                    keccak256(proof.states[i].encode()),
                    _tx.fromIndex,
                    proof.stateWitnesses[i]
                ),
                "Rollup: state inclusion signer"
            );

            // check pubkey inclusion
            require(
                MerkleTreeUtilsLib.verifyLeaf(
                    accountRoot,
                    keccak256(abi.encodePacked(proof.pubkeysSender[i])),
                    proof.states[i].pubkeyIndex,
                    proof.pubkeyWitnessesSender[i]
                ),
                "Rollup: from account does not exists"
            );

            // check receiver pubkye inclusion at committed accID
            require(
                MerkleTreeUtilsLib.verifyLeaf(
                    accountRoot,
                    keccak256(abi.encodePacked(proof.pubkeysReceiver[i])),
                    _tx.toAccID,
                    proof.pubkeyWitnessesReceiver[i]
                ),
                "Rollup: to account does not exists"
            );

            // construct the message
            require(proof.states[i].nonce > 0, "Rollup: zero nonce");

            bytes memory txMsg = Tx.create2Transfer_messageOf(
                _tx,
                proof.states[i].nonce - 1,
                proof.pubkeysSender[i],
                proof.pubkeysReceiver[i]
            );

            // make the message
            messages[i] = BLS.hashToPoint(domain, txMsg);
        }

        if (!BLS.verifyMultiple(signature, proof.pubkeysSender, messages)) {
            return Types.Result.BadSignature;
        }
        return Types.Result.Ok;
    }

    /**
     * @notice processes the state transition of a commitment
     * @return updatedRoot, txRoot and if the batch is valid or not
     * */
    function processCreate2TransferCommit(
        bytes32 stateRoot,
        bytes memory txs,
        Types.StateMerkleProof[] memory proofs,
        uint256 tokenType,
        uint256 feeReceiver
    ) public pure returns (bytes32, Types.Result result) {
        uint256 length = txs.create2Transfer_size();

        uint256 fees;
        Tx.Create2Transfer memory _tx;

        for (uint256 i = 0; i < length; i++) {
            // call process tx update for every transaction to check if any
            // tx evaluates correctly
            _tx = txs.create2Transfer_decode(i);
            fees = fees.add(_tx.fee);
            (stateRoot, , , result) = processTx(
                stateRoot,
                _tx,
                tokenType,
                proofs[i * 2],
                proofs[i * 2 + 1]
            );
            if (result != Types.Result.Ok) {
                break;
            }
        }

        if (result == Types.Result.Ok) {
            (stateRoot, result) = processFee(
                stateRoot,
                fees,
                tokenType,
                feeReceiver,
                proofs[length * 2]
            );
        }

        return (stateRoot, result);
    }

    /**
     * @notice processTx processes a transactions and returns the updated balance tree
     *  and the updated leaves
     * conditions in require mean that the dispute be declared invalid
     * if conditons evaluate if the coordinator was at fault
     * @return Total number of batches submitted onchain
     */
    function processTx(
        bytes32 stateRoot,
        Tx.Create2Transfer memory _tx,
        uint256 tokenType,
        Types.StateMerkleProof memory from,
        Types.StateMerkleProof memory to
    )
        public
        pure
        returns (
            bytes32,
            bytes memory,
            bytes memory,
            Types.Result
        )
    {
        require(
            MerkleTreeUtilsLib.verifyLeaf(
                stateRoot,
                keccak256(from.state.encode()),
                _tx.fromIndex,
                from.witness
            ),
            "Create2Transfer: sender does not exist"
        );

        Types.Result result = FraudProofHelpers.validateTxBasic(
            _tx.amount,
            _tx.fee,
            from.state
        );
        if (result != Types.Result.Ok) return (bytes32(0), "", "", result);

        if (from.state.tokenType != tokenType) {
            return (bytes32(0), "", "", Types.Result.BadFromTokenType);
        }

        bytes32 newRoot;
        bytes memory new_from_account;
        bytes memory new_to_account;

        (new_from_account, newRoot) = ApplyCreate2TransferSender(from, _tx);

        // Validate we are creating on a zero account
        require(
            MerkleTreeUtilsLib.verifyLeaf(
                newRoot,
                keccak256(abi.encode(0)),
                _tx.toIndex,
                to.witness
            ),
            "Create2Transfer: receiver proof invalid"
        );

        (new_to_account, newRoot) = ApplyCreate2TransferReceiver(
            to,
            _tx,
            from.state.tokenType
        );

        return (newRoot, new_from_account, new_to_account, Types.Result.Ok);
    }

    function ApplyCreate2TransferSender(
        Types.StateMerkleProof memory _merkle_proof,
        Tx.Create2Transfer memory _tx
    ) public pure returns (bytes memory newState, bytes32 newRoot) {
        Types.UserState memory state = _merkle_proof.state;
        state.balance = state.balance.sub(_tx.amount).sub(_tx.fee);
        state.nonce++;
        bytes memory encodedState = state.encode();
        newRoot = MerkleTreeUtilsLib.rootFromWitnesses(
            keccak256(encodedState),
            _tx.fromIndex,
            _merkle_proof.witness
        );
        return (encodedState, newRoot);
    }

    function ApplyCreate2TransferReceiver(
        Types.StateMerkleProof memory _merkle_proof,
        Tx.Create2Transfer memory _tx,
        uint256 token
    ) public pure returns (bytes memory updatedAccount, bytes32 newRoot) {
        // Initialize account
        Types.UserState memory newState = Types.UserState(
            _tx.toAccID,
            token,
            _tx.amount,
            0
        );

        bytes memory encodedState = newState.encode();
        newRoot = MerkleTreeUtilsLib.rootFromWitnesses(
            keccak256(encodedState),
            _tx.toIndex,
            _merkle_proof.witness
        );
        return (encodedState, newRoot);
    }

    function processFee(
        bytes32 stateRoot,
        uint256 fees,
        uint256 tokenType,
        uint256 feeReceiver,
        Types.StateMerkleProof memory stateLeafProof
    ) public pure returns (bytes32 newRoot, Types.Result) {
        Types.UserState memory state = stateLeafProof.state;
        if (state.tokenType != tokenType) {
            return (bytes32(0), Types.Result.BadToTokenType);
        }
        require(
            MerkleTreeUtilsLib.verifyLeaf(
                stateRoot,
                keccak256(state.encode()),
                feeReceiver,
                stateLeafProof.witness
            ),
            "Create2Transfer: fee receiver does not exist"
        );
        state.balance = state.balance.add(fees);
        newRoot = MerkleTreeUtilsLib.rootFromWitnesses(
            keccak256(state.encode()),
            feeReceiver,
            stateLeafProof.witness
        );
        return (newRoot, Types.Result.Ok);
    }
}