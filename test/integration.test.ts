import { assert } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { AccountRegistry } from "../ts/accountTree";
import { allContracts } from "../ts/allContractsInterfaces";
import {
    BLOCKS_PER_SLOT,
    DELTA_BLOCKS_INITIAL_SLOT,
    PRODUCTION_PARAMS
} from "../ts/constants";
import { deployAll } from "../ts/deploy";
import { UserStateFactory } from "../ts/factory";
import { DeploymentParameters } from "../ts/interfaces";
import { StateTree } from "../ts/stateTree";
import { TestTokenFactory } from "../types/ethers-contracts";
import { BurnAuction } from "../types/ethers-contracts/BurnAuction";
import * as mcl from "../ts/mcl";
import { TestToken } from "../types/ethers-contracts/TestToken";
import { BodylessCommitment, getGenesisProof } from "../ts/commitments";
import { getBatchID, mineBlocks } from "../ts/utils";

const DOMAIN =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

describe("Integration Test", function() {
    let contracts: allContracts;
    let stateTree: StateTree;
    let parameters: DeploymentParameters;
    let deployer: Signer;
    let coordinator: Signer;
    let accountRegistry: AccountRegistry;
    let newToken: TestToken;

    before(async function() {
        await mcl.init();
        mcl.setDomainHex(DOMAIN);
        [deployer, coordinator] = await ethers.getSigners();
        parameters = PRODUCTION_PARAMS;
        stateTree = StateTree.new(parameters.MAX_DEPTH);
        parameters.GENESIS_STATE_ROOT = stateTree.root;
        contracts = await deployAll(deployer, parameters);

        accountRegistry = await AccountRegistry.new(
            contracts.blsAccountRegistry
        );
    });
    it("Register another token", async function() {
        const { tokenRegistry } = contracts;
        newToken = await new TestTokenFactory(coordinator).deploy();
        await tokenRegistry.requestRegistration(newToken.address);
        const tx = await tokenRegistry.finaliseRegistration(newToken.address);
        const [event] = await tokenRegistry.queryFilter(
            tokenRegistry.filters.RegisteredToken(null, null),
            tx.blockHash
        );
        // In the deploy script, we already have a TestToken registered with tokenID 1
        assert.equal(event.args?.tokenType, 2);
    });
    it("Coordinator bid the first auction", async function() {
        const burnAuction = contracts.chooser as BurnAuction;
        await burnAuction.connect(coordinator).bid({ value: "1" });
        await mineBlocks(
            ethers.provider,
            DELTA_BLOCKS_INITIAL_SLOT + BLOCKS_PER_SLOT * 2
        );
        // Slot 2 is when the auction finalize and the coordinator can propose
        assert.equal(Number(await burnAuction.currentSlot()), 2);
    });
    it("Deposit some users", async function() {
        const { depositManager, rollup } = contracts;
        const subtreeSize = 1 << parameters.MAX_DEPOSIT_SUBTREE_DEPTH;
        const nSubtrees = 5;
        const nDeposits = nSubtrees * subtreeSize;
        const states = UserStateFactory.buildList({
            numOfStates: nDeposits,
            initialStateID: 0,
            initialAccID: 0,
            tokenID: 2,
            zeroNonce: true
        });

        const fromBlockNumber = await deployer.provider?.getBlockNumber();
        for (const state of states) {
            const pubkeyID = await accountRegistry.register(state.getPubkey());
            assert.equal(pubkeyID, state.pubkeyIndex);
            await newToken
                .connect(coordinator)
                .approve(depositManager.address, state.balance);
            await depositManager
                .connect(coordinator)
                .depositFor(state.pubkeyIndex, state.balance, state.tokenType);
        }

        const subtreeReadyEvents = await depositManager.queryFilter(
            depositManager.filters.DepositSubTreeReady(null),
            fromBlockNumber
        );
        assert.equal(subtreeReadyEvents.length, nSubtrees);
        let previousProof = getGenesisProof(
            parameters.GENESIS_STATE_ROOT as string
        );
        for (let i = 0; i < nSubtrees; i++) {
            const mergeOffsetLower = i * subtreeSize;
            const statesToUpdate = states.slice(
                mergeOffsetLower,
                mergeOffsetLower + subtreeSize
            );
            const vacant = stateTree.getVacancyProof(
                mergeOffsetLower,
                parameters.MAX_DEPOSIT_SUBTREE_DEPTH
            );
            await rollup
                .connect(coordinator)
                .submitDeposits(previousProof, vacant, {
                    value: parameters.STAKE_AMOUNT
                });
            const batchID = await getBatchID(rollup);
            stateTree.createStateBulk(statesToUpdate);
            const depositBatch = new BodylessCommitment(
                stateTree.root
            ).toBatch();
            const batch = await rollup.getBatch(batchID);
            assert.equal(batch.commitmentRoot, depositBatch.commitmentRoot);
            previousProof = depositBatch.proofCompressed(0);
        }
    });
    it("Users doing Transfers");
    it("Getting new users via Create to transfer");
    it("Exit via mass migration");
    it("Users withdraw funds");
    it("Coordinator withdrew their stack");
});