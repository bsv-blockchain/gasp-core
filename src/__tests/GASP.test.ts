import { GASP, GASPInitialRequest, GASPNode, GASPNodeResponse, GASPStorage, GASPRemote, GASPVersionMismatchError } from '../GASP'

// Mock implementations
const mockStorage: GASPStorage = {
    findKnownUTXOs: jest.fn().mockResolvedValue([
        { txid: 'txid1', outputIndex: 0 },
        { txid: 'txid2', outputIndex: 1 },
    ]),
    hydrateGASPNode: jest.fn().mockImplementation((txid: string, outputIndex: number, metadata: boolean) => {
        return Promise.resolve({
            graphID: `${txid}:${outputIndex}`,
            tx: txid,
            outputIndex,
            proof: metadata ? 'proof' : undefined,
            txMetadata: metadata ? 'txMetadata' : undefined,
            outputMetadata: metadata ? 'outputMetadata' : undefined,
            inputs: metadata ? { 'input1': { hash: 'hash1' } } : undefined,
        })
    }),
    findNeededInputs: jest.fn().mockImplementation((tx: GASPNode) => {
        return Promise.resolve({
            requestedInputs: {
                'txid1:0': { metadata: true }
            }
        })
    }),
    appendToGraph: jest.fn().mockResolvedValue(undefined),
    validateGraphAnchor: jest.fn().mockResolvedValue(undefined),
    discardGraph: jest.fn().mockResolvedValue(undefined),
    finalizeGraph: jest.fn().mockResolvedValue(undefined),
}

const mockRemote: GASPRemote = {
    getInitialResponse: jest.fn().mockResolvedValue([
        {
            graphID: 'txid1:0',
            tx: 'txid1',
            outputIndex: 0,
            proof: 'proof',
            txMetadata: 'txMetadata',
            outputMetadata: 'outputMetadata',
            inputs: { 'input1': { hash: 'hash1' } },
        }
    ]),
    requestNode: jest.fn().mockImplementation((txid: string, outputIndex: number, metadata: boolean) => {
        return Promise.resolve({
            graphID: `${txid}:${outputIndex}`,
            tx: txid,
            outputIndex,
            proof: metadata ? 'proof' : undefined,
            txMetadata: metadata ? 'txMetadata' : undefined,
            outputMetadata: metadata ? 'outputMetadata' : undefined,
            inputs: metadata ? { 'input1': { hash: 'hash1' } } : undefined,
        })
    }),
    getFilter: jest.fn().mockResolvedValue('txid1:0,txid2:1'),
    submitNode: jest.fn().mockImplementation((node: GASPNode) => {
        return Promise.resolve({
            requestedInputs: {
                'txid1:0': { metadata: true }
            }
        })
    }),
}

describe('GASP', () => {
    let gasp: GASP

    beforeEach(() => {
        gasp = new GASP(mockStorage, mockRemote)
    })

    it('should build initial request correctly', async () => {
        const initialRequest = await gasp.buildInitialRequest()
        expect(initialRequest).toEqual({
            version: 1,
            UTXOBloom: 'txid1:0,txid2:1'
        })
    })

    it('should handle version mismatch in buildInitialResponse', async () => {
        const incorrectRequest: GASPInitialRequest = {
            version: 2,
            UTXOBloom: 'filter'
        }

        await expect(gasp.buildInitialResponse(incorrectRequest)).rejects.toThrow(GASPVersionMismatchError)
    })

    it('should build initial response correctly', async () => {
        const request: GASPInitialRequest = {
            version: 1,
            UTXOBloom: 'filter'
        }

        const response = await gasp.buildInitialResponse(request)
        expect(response).toEqual([
            {
                graphID: 'txid1:0',
                tx: 'txid1',
                outputIndex: 0,
                proof: 'proof',
                txMetadata: 'txMetadata',
                outputMetadata: 'outputMetadata',
                inputs: { 'input1': { hash: 'hash1' } }
            }
        ])
    })

    it('should process incoming nodes correctly', async () => {
        const node: GASPNode = {
            graphID: 'txid1:0',
            tx: 'txid1',
            outputIndex: 0,
            proof: 'proof',
            txMetadata: 'txMetadata',
            outputMetadata: 'outputMetadata',
            inputs: { 'input1': { hash: 'hash1' } }
        }

        await gasp.processIncomingNode(node)
        expect(mockStorage.appendToGraph).toHaveBeenCalledWith(node, undefined)
        expect(mockStorage.validateGraphAnchor).toHaveBeenCalledWith(node.graphID)
        expect(mockStorage.finalizeGraph).toHaveBeenCalledWith(node.graphID)
    })

    it('should process outgoing nodes correctly', async () => {
        const node: GASPNode = {
            graphID: 'txid1:0',
            tx: 'txid1',
            outputIndex: 0,
            proof: 'proof',
            txMetadata: 'txMetadata',
            outputMetadata: 'outputMetadata',
            inputs: { 'input1': { hash: 'hash1' } }
        }

        await gasp.processOutgoingNode(node)
        expect(mockRemote.submitNode).toHaveBeenCalledWith(node)
    })

    it('should sync correctly', async () => {
        await gasp.sync()
        expect(mockRemote.getInitialResponse).toHaveBeenCalled()
        expect(mockRemote.getFilter).toHaveBeenCalled()
        expect(mockStorage.findKnownUTXOs).toHaveBeenCalled()
    })
})
