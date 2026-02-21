// Implement getCbor function to write the CBOR of the validator script to a file
const code = `
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module Main where

import Prelude (IO, print, putStrLn)
import qualified Prelude as P
import PlutusTx
import PlutusTx.Prelude hiding (Semigroup(..), unless)
import qualified Plutus.V2.Ledger.Api as PlutusV2
import qualified Data.ByteString.Short as SBS
import qualified Data.ByteString.Lazy as LBS
import qualified Codec.Serialise as Serialise
import Cardano.Api
import Cardano.Api.Shelley (PlutusScript (..))

{-# INLINEABLE untypedValidator #-}
untypedValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
untypedValidator _ _ _ = ()

validatorScript :: PlutusV2.Validator
validatorScript =
  PlutusV2.mkValidatorScript
    $$(PlutusTx.compile [|| untypedValidator ||])

-- Convert to CBOR
validatorToCBOR :: PlutusV2.Validator -> LBS.ByteString
validatorToCBOR val =
  Serialise.serialise val

writePlutusFile :: FilePath -> PlutusV2.Validator -> IO ()
writePlutusFile file val = do
  let scriptSerialised = Serialise.serialise val
  LBS.writeFile file scriptSerialised

main :: IO ()
main = do
  writePlutusFile "./assets/output.plutus" validatorScript
  putStrLn "Validator CBOR written to ./assets/output.plutus"
`