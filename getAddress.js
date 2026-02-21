

// --- CONSTANTS/FUNCTIONS (Assume pasted here from the previous response) ---
// const SCRIPT_ADDRESS = "addr_test1qr...your...script...address";
// const createStakeTransaction = async (lucid, lovelaceAmount) => { ... };
// const claimAndUnstake = async (lucid, utxo) => { ... };


// ====================================================================
// 6. WALLET CONNECTION AND INITIALIZATION
// ====================================================================

/**
 * Initializes Lucid and connects to a browser wallet.
 */
export async function connectWallet(validatorCbor="") {

    try {
        // 1. Initialize Lucid instance
        // You MUST configure this for your target network (Mainnet, Preprod, etc.)
        lucid = await Lucid.new(

            new Blockfrost(
                "https://cardano-preprod.blockfrost.io/api/v0",
                "preprodYjRkHfcazNkL0xxG9C2RdUbUoTrG7wip"
            ),
            "Preprod"


        );

        // 2. Request connection from the user's wallet (e.g., Nami)
        let selectedWallet = null;
        let walletFound = false;
        if (window.cardano) {
             if (window.cardano.lace) {
                selectedWallet = window.cardano.lace;
                walletFound = true;
            }
            else if (window.cardano.nami) {
                selectedWallet = window.cardano.nami;
                walletFound = true;
            }
           
            else if(window.cardano.eternl) {
                selectedWallet = window.cardano.eternl;
                walletFound = true;
            } 
            else  alert("No supported wallet found. Please install Nami, Lace, or Eternl.")
        }
        else alert("No supported wallet found. Please install Nami, Lace, or Eternl.")
        if (!walletFound) return;

        console.log("Selected Wallet:", selectedWallet);
        lucid.selectWallet(selectedWallet);
        let validatorAddress = null;

        if(validatorCbor !== ""){
        const validator = {
            type: "PlutusV2",
            script: validatorCbor
        }
       validatorAddress = lucid.utils.validatorToAddress(validator)
        }
        

        const walletAddress = await lucid.wallet.address();

        walletStatus.textContent = `Status: Connected | Address: ${walletAddress.substring(0, 15)}...`;

        


        return { lucid, walletAddress, validatorAddress }
        // In a real app, you would now call a function to fetch UTxOs.
        // fetchStakedUTxOs(walletAddress);

    } catch (error) {
       alert("Wallet connection failed:", error);
    }
}

