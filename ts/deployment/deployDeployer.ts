import { Signer } from "ethers";
import { DeployerFactory } from "../../types/ethers-contracts/DeployerFactory";
import { BigNumber } from "ethers";
import assert from "assert";
import { keylessDeploy, calculateKeylessDeployment } from "./keylessDeployment";
import { Provider } from "@ethersproject/providers";
import { DEPLOYER_ADDRESS, KEYLESS_DEPLOYMENT } from "./static";
import { logAddress, logDeployment } from "../../scripts/logger";
import { ProxyFactory } from "../../types/ethers-contracts/ProxyFactory";

export async function calculateDeployerAddress(
    provider?: Provider
): Promise<{ deployerAddress: string; keylessAccount: string }> {
    let result = await calculateKeylessDeployment(
        provider,
        deployerBytecode(),
        KEYLESS_DEPLOYMENT.GAS_PRICE,
        KEYLESS_DEPLOYMENT.GAS_LIMIT,
        false
    );
    return {
        deployerAddress: result.contractAddress,
        keylessAccount: result.keylessAccount
    };
}

export async function calculateGasLimit(
    provider: Provider
): Promise<BigNumber> {
    let result = await calculateKeylessDeployment(
        provider,
        deployerBytecode(),
        KEYLESS_DEPLOYMENT.GAS_PRICE,
        KEYLESS_DEPLOYMENT.GAS_LIMIT,
        false
    );
    return result.estimatedGasCost;
}

export async function deployDeployer(
    signer: Signer,
    verbose: boolean
): Promise<boolean> {
    assert(signer.provider);
    const provider = signer.provider;
    const result = await calculateKeylessDeployment(
        provider,
        deployerBytecode(),
        KEYLESS_DEPLOYMENT.GAS_PRICE,
        KEYLESS_DEPLOYMENT.GAS_LIMIT,
        verbose
    );

    if (result.alreadyDeployed) {
        logAddress(
            verbose,
            "Deployer is ALREADY deployed",
            result.contractAddress
        );
        return true;
    }
    assert(KEYLESS_DEPLOYMENT.GAS_LIMIT.gte(result.estimatedGasCost));
    assert(DEPLOYER_ADDRESS == result.contractAddress);
    const _result = await keylessDeploy(
        signer,
        deployerBytecode(),
        KEYLESS_DEPLOYMENT.GAS_PRICE,
        KEYLESS_DEPLOYMENT.GAS_LIMIT,
        verbose
    );
    logDeployment(
        verbose,
        "Deployed: Deployer",
        _result.receipt.transactionHash,
        _result.contractAddress
    );
    return true;
}

export function proxyBytecode(): string {
    const _proxyBytecode =
        "0x608060405234801561001057600080fd5b50610218806100206000396000f3fe6080604052600436106100295760003560e01c80630fd5b6ae14610033578063bd5b220214610064575b610031610097565b005b34801561003f57600080fd5b506100486100b1565b604080516001600160a01b039092168252519081900360200190f35b34801561007057600080fd5b506100316004803603602081101561008757600080fd5b50356001600160a01b03166100c0565b61009f6100af565b6100af6100aa61019a565b6101bf565b565b60006100bb61019a565b905090565b60006100ca61019a565b6001600160a01b031614610125576040805162461bcd60e51b815260206004820152601a60248201527f50726f78793a20616c726561647920696e697469616c697a6564000000000000604482015290519081900360640190fd5b6001600160a01b038116610176576040805162461bcd60e51b815260206004820152601360248201527250726f78793a207a65726f206164647265737360681b604482015290519081900360640190fd5b7f7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c355565b7f7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c35490565b3660008037600080366000845af43d6000803e8080156101de573d6000f35b3d6000fdfea265627a7a72315820c280737031be2c6d3b410c09f08919c2cede3c62685b4b8ae0ae9fec75a0c15f64736f6c634300050f0032";

    const proxyFactory = new ProxyFactory();
    if (_proxyBytecode != proxyFactory.bytecode) {
        console.log("WARNING: Proxy bytecode disparity");
    }

    return _proxyBytecode;
}

export function deployerBytecode(): string {
    const _bytecodeDeployer =
        "0x608060405234801561001057600080fd5b50610501806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806332c02a141461003b578063c090587f14610083575b600080fd5b6100676004803603604081101561005157600080fd5b506001600160a01b0381351690602001356100a0565b604080516001600160a01b039092168252519081900360200190f35b6100676004803603602081101561009957600080fd5b5035610198565b60006100b36100ae836101a9565b610221565b156100fe576040805162461bcd60e51b815260206004820152601660248201527511195c1b1bde595c8e881cd85b1d081a5cc81d5cd95960521b604482015290519081900360640190fd5b606061010861025d565b9050828151602083016000f59150813b61012157600080fd5b816001600160a01b031663bd5b2202856040518263ffffffff1660e01b815260040180826001600160a01b03166001600160a01b03168152602001915050600060405180830381600087803b15801561017957600080fd5b505af115801561018d573d6000803e3d6000fd5b505050505092915050565b60006101a3826101a9565b92915050565b600060ff30836101b761025d565b80519060200120604051602001808560ff1660ff1660f81b8152600101846001600160a01b03166001600160a01b031660601b81526014018381526020018281526020019450505050506040516020818303038152906040528051906020012060001c9050919050565b6000813f7fc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a47081811480159061025557508115155b949350505050565b60606040518060200161026f90610287565b601f1982820381018352601f90910116604052905090565b610238806102958339019056fe608060405234801561001057600080fd5b50610218806100206000396000f3fe6080604052600436106100295760003560e01c80630fd5b6ae14610033578063bd5b220214610064575b610031610097565b005b34801561003f57600080fd5b506100486100b1565b604080516001600160a01b039092168252519081900360200190f35b34801561007057600080fd5b506100316004803603602081101561008757600080fd5b50356001600160a01b03166100c0565b61009f6100af565b6100af6100aa61019a565b6101bf565b565b60006100bb61019a565b905090565b60006100ca61019a565b6001600160a01b031614610125576040805162461bcd60e51b815260206004820152601a60248201527f50726f78793a20616c726561647920696e697469616c697a6564000000000000604482015290519081900360640190fd5b6001600160a01b038116610176576040805162461bcd60e51b815260206004820152601360248201527250726f78793a207a65726f206164647265737360681b604482015290519081900360640190fd5b7f7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c355565b7f7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c35490565b3660008037600080366000845af43d6000803e8080156101de573d6000f35b3d6000fdfea265627a7a72315820c280737031be2c6d3b410c09f08919c2cede3c62685b4b8ae0ae9fec75a0c15f64736f6c634300050f0032a265627a7a723158204ba46b4927debb1c1a935a0355c06a56129992e651124407c95f35579a6cb21764736f6c634300050f0032";

    // FIX: bytecode differs in ci environment
    const deployerFactory = new DeployerFactory();
    if (_bytecodeDeployer != deployerFactory.bytecode) {
        console.log("WARNING: Deployer bytecode disparity");
    }

    return _bytecodeDeployer;
}
