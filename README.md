# GASP - Graph Aware Sync Protocol

GASP (Graph Aware Sync Protocol) is a protocol designed to synchronize transaction data between two parties in a blockchain environment. It ensures the legitimacy and completeness of transaction data using a recursive reconciliation method.

## Features

- Synchronizes transaction data between two parties.
- Ensures legitimacy and completeness of transaction data.
- Recursive reconciliation method.
- Adaptable to various blockchain environments.
- Emphasizes security, efficiency, and data integrity.

## Installation

To install the GASP library, run:

```bash
npm install gasp-protocol
```

## Usage

### Example Usage

Here's a basic example demonstrating how to use the GASP library:

```typescript
import { GASP, GASPStorage, GASPRemote } from 'gasp-protocol'

// Mock implementations
const mockStorage: GASPStorage = {
  findKnownUTXOs: async () => [
    { txid: 'txid1', outputIndex: 0 },
    { txid: 'txid2', outputIndex: 1 },
  ],
  hydrateGASPNode: async (txid: string, outputIndex: number, metadata: boolean) => ({
    graphID: `${txid}:${outputIndex}`,
    tx: txid,
    outputIndex,
    proof: metadata ? 'proof' : undefined,
    txMetadata: metadata ? 'txMetadata' : undefined,
    outputMetadata: metadata ? 'outputMetadata' : undefined,
    inputs: metadata ? { 'input1': { hash: 'hash1' } } : undefined,
  }),
  findNeededInputs: async (tx: GASPNode) => ({
    requestedInputs: {
      'txid1:0': { metadata: true }
    }
  }),
  appendToGraph: async (tx: GASPNode, spentBy?: string) => {},
  validateGraphAnchor: async (graphID: string) => {},
  discardGraph: async (graphID: string) => {},
  finalizeGraph: async (graphID: string) => {},
}

const mockRemote: GASPRemote = {
  getInitialResponse: async (request: GASPInitialRequest) => [
    {
      graphID: 'txid1:0',
      tx: 'txid1',
      outputIndex: 0,
      proof: 'proof',
      txMetadata: 'txMetadata',
      outputMetadata: 'outputMetadata',
      inputs: { 'input1': { hash: 'hash1' } },
    }
  ],
  requestNode: async (txid: string, outputIndex: number, metadata: boolean) => ({
    graphID: `${txid}:${outputIndex}`,
    tx: txid,
    outputIndex,
    proof: metadata ? 'proof' : undefined,
    txMetadata: metadata ? 'txMetadata' : undefined,
    outputMetadata: metadata ? 'outputMetadata' : undefined,
    inputs: metadata ? { 'input1': { hash: 'hash1' } } : undefined,
  }),
  getFilter: async () => 'txid1:0,txid2:1',
  submitNode: async (node: GASPNode) => ({
    requestedInputs: {
      'txid1:0': { metadata: true }
    }
  }),
}

const gasp = new GASP(mockStorage, mockRemote)

gasp.sync().then(() => {
  console.log('Synchronization complete!')
}).catch(err => {
  console.error('Synchronization failed:', err)
})
```

## License

The license for the code in this repository is the Open BSV License.