/* eslint-env jest */
import { GASP, GASPInitialRequest, GASPNode, GASPNodeResponse, GASPStorage, GASPRemote, GASPInitialReply, GASPInitialResponse } from '../GASP'

type Graph = {
    graphID: string,
    time: number,
    txid: string,
    outputIndex: number,
    rawTx: string,
    inputs: Record<string, Graph>
}

// Used to construct a non-functional remote that will be replaced after being constructed.
// Useful when directly using another GASP instance as a remote.
const throwawayRemote: GASPRemote = {
    getInitialResponse: function (request: GASPInitialRequest): Promise<GASPInitialResponse> {
        throw new Error('Function not implemented.')
    },
    getInitialReply: function (response: GASPInitialResponse): Promise<GASPInitialReply> {
        throw new Error('Function not implemented.')
    },
    requestNode: function (graphID: string, txid: string, outputIndex: number, metadata: boolean): Promise<GASPNode> {
        throw new Error('Function not implemented.')
    },
    submitNode: function (node: GASPNode): Promise<void | GASPNodeResponse> {
        throw new Error('Function not implemented.')
    }
}

class MockStorage implements GASPStorage {
    knownStore: Array<Graph>
    tempGraphStore: Record<string, Graph>
    updateCallback: Function
    logPrefix: string
    log: boolean

    constructor(knownStore: Array<Graph> = [], tempGraphStore: Record<string, Graph> = {}, updateCallback: Function = () => { }, logPrefix = '[Storage] ', log = false) {
        this.knownStore = knownStore
        this.tempGraphStore = tempGraphStore
        this.updateCallback = updateCallback
        this.logPrefix = logPrefix
        this.log = log

        // Initialize methods with default implementations
        this.findKnownUTXOs = jest.fn(this.findKnownUTXOs.bind(this))
        this.hydrateGASPNode = jest.fn(this.hydrateGASPNode.bind(this))
        this.findNeededInputs = jest.fn(this.findNeededInputs.bind(this))
        this.appendToGraph = jest.fn(this.appendToGraph.bind(this))
        this.validateGraphAnchor = jest.fn(this.validateGraphAnchor.bind(this))
        this.discardGraph = jest.fn(this.discardGraph.bind(this))
        this.finalizeGraph = jest.fn(this.finalizeGraph.bind(this))
    }

    private logData(...data: any): void {
        if (this.log) {
            console.log(this.logPrefix, ...data)
        }
    }

    async findKnownUTXOs(since: number): Promise<{ txid: string; outputIndex: number }[]> {
        const utxos = this.knownStore
            .filter(x => !x.time || x.time > since) // Include UTXOs with no timestamp or timestamps greater than 'since'
            .map(x => ({ txid: x.txid, outputIndex: x.outputIndex }))
        this.logData('findKnownUTXOs', since, utxos)
        return utxos
    }

    async hydrateGASPNode(graphID: string, txid: string, outputIndex: number, metadata: boolean): Promise<GASPNode> {
        const found = this.knownStore.find(x => x.txid === txid && x.outputIndex === outputIndex)
        if (!found) {
            throw new Error('Not found')
        }
        this.logData('hydrateGASPNode', graphID, txid, outputIndex, metadata, found)
        return {
            graphID,
            rawTx: found.rawTx,
            outputIndex: found.outputIndex,
            proof: 'mock_proof', // Mock proof
            txMetadata: metadata ? 'mock_tx_metadata' : undefined,
            outputMetadata: metadata ? 'mock_output_metadata' : undefined,
            inputs: metadata ? { 'mock_input': { hash: 'mock_hash' } } : undefined
        }
    }

    async findNeededInputs(tx: GASPNode): Promise<void | GASPNodeResponse> {
        this.logData('findNeededInputs', tx)
        // For testing, assume no additional inputs are needed, unless specified
        if (tx.graphID.includes('recursive')) {
            return {
                requestedInputs: {
                    'recursive_txid.1': { metadata: true }
                }
            }
        }
        return
    }

    async appendToGraph(tx: GASPNode, spentBy?: string | undefined): Promise<void> {
        this.logData('appendToGraph', tx, spentBy)
        this.tempGraphStore[tx.graphID] = {
            ...tx,
            time: Date.now(),
            txid: tx.graphID.split('.')[0],
            inputs: {}
        }
    }

    async validateGraphAnchor(graphID: string): Promise<void> {
        this.logData('validateGraphAnchor', graphID)
        // Allow validation to pass
    }

    async discardGraph(graphID: string): Promise<void> {
        this.logData('discardGraph', graphID)
        delete this.tempGraphStore[graphID]
    }

    async finalizeGraph(graphID: string): Promise<void> {
        const tempGraph = this.tempGraphStore[graphID]
        if (tempGraph) {
            this.logData('finalizeGraph', graphID, tempGraph)
            this.knownStore.push(tempGraph)
            this.updateCallback()
            delete this.tempGraphStore[graphID]
        } else {
            this.logData('no graph to finalize', graphID, tempGraph)
        }
    }
}

const mockUTXO = {
    graphID: 'mock_sender1_txid1.0',
    rawTx: 'mock_sender1_rawtx1',
    outputIndex: 0,
    time: 111,
    txid: 'mock_sender1_txid1',
    inputs: {}
}

const mockInputNode = {
    graphID: 'mock_sender1_txid1.0',
    rawTx: 'deadbeef01010101',
    outputIndex: 0,
    time: 222,
    txid: 'mock_sender1_txid2',
    inputs: {}
}

const mockUTXOWithInput = {
    ...mockUTXO,
    inputs: {
        'mock_sender1_txid2.0': mockInputNode
    }
}

describe('GASP', () => {
    afterEach(() => {
        jest.resetAllMocks()
    })
    it('Fails to sync if versions are wrong', async () => {
        const originalError = console.error
        console.error = jest.fn()
        const storage1 = new MockStorage()
        const storage2 = new MockStorage()
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        gasp1.version = 2
        await expect(gasp1.sync()).rejects.toThrow(new Error('GASP version mismatch. Current version: 1, foreign version: 2'))
        expect(console.error).toHaveBeenCalledWith('GASP version mismatch error: GASP version mismatch. Current version: 1, foreign version: 2')
        console.error = originalError
    })
    it('Synchronizes a single UTXO from Alice to Bob', async () => {
        const storage1 = new MockStorage([mockUTXO])
        const storage2 = new MockStorage()
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage2.findKnownUTXOs(0)).length).toBe(1)
        expect(await storage2.findKnownUTXOs(0)).toEqual(await storage1.findKnownUTXOs(0))
    })
    it('Synchronizes a single UTXO from Bob to Alice', async () => {
        const storage1 = new MockStorage()
        const storage2 = new MockStorage([mockUTXO])
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage1.findKnownUTXOs(0)).length).toBe(1)
        expect(await storage1.findKnownUTXOs(0)).toEqual(await storage2.findKnownUTXOs(0))
    })
    it('Discards graphs that do not validate from Alice to Bob', async () => {
        const storage1 = new MockStorage([mockUTXO])
        const storage2 = new MockStorage()
        storage2.validateGraphAnchor = jest.fn().mockImplementation((graphID: string) => {
            throw new Error('Invalid graph anchor.')
        })
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage2.findKnownUTXOs(0)).length).toBe(0)
        expect(storage2.discardGraph).toHaveBeenCalledWith('mock_sender1_txid1.0')
    })
    it('Discards graphs that do not validate from Bob to Alice', async () => {
        const storage1 = new MockStorage()
        const storage2 = new MockStorage([mockUTXO])
        storage1.validateGraphAnchor = jest.fn().mockImplementation((graphID: string) => {
            throw new Error('Invalid graph anchor.')
        })
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage1.findKnownUTXOs(0)).length).toBe(0)
        expect(storage1.discardGraph).toHaveBeenCalledWith('mock_sender1_txid1.0')
    })
    it('Synchronizes a deep UTXO from Bob to Alice', async () => {
        const storage1 = new MockStorage()
        storage1.findNeededInputs = jest.fn().mockImplementationOnce(async (n: GASPNode): Promise<GASPNodeResponse> => {
            return {
                requestedInputs: {
                    'mock_sender1_txid2.0': {
                        metadata: true
                    }
                }
            }
        })
        const storage2 = new MockStorage([mockUTXOWithInput])
        storage2.hydrateGASPNode = jest.fn().mockReturnValueOnce(mockUTXO).mockReturnValueOnce(mockInputNode)
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage1.findKnownUTXOs(0)).length).toBe(1)
        expect(await storage1.findKnownUTXOs(0)).toEqual(await storage2.findKnownUTXOs(0))
    })
    it('Synchronizes a deep UTXO from Alice to Bob', async () => {
        const storage2 = new MockStorage()
        storage2.findNeededInputs = jest.fn().mockImplementationOnce(async (n: GASPNode): Promise<GASPNodeResponse> => {
            return {
                requestedInputs: {
                    'mock_sender1_txid2.0': {
                        metadata: true
                    }
                }
            }
        })
        const storage1 = new MockStorage([mockUTXOWithInput])
        storage1.hydrateGASPNode = jest.fn().mockReturnValueOnce(mockUTXO).mockReturnValueOnce(mockInputNode)
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage2.findKnownUTXOs(0)).length).toBe(1)
        expect(await storage2.findKnownUTXOs(0)).toEqual(await storage1.findKnownUTXOs(0))
    })
    it('Synchronizes multiple graphs from Alice to Bob', async () => {
        const mockUTXO2 = {
            graphID: 'mock_sender2_txid1.0',
            rawTx: 'mock_sender2_rawtx1',
            outputIndex: 0,
            time: 222,
            txid: 'mock_sender2_txid1',
            inputs: {}
        }

        const storage1 = new MockStorage([mockUTXO, mockUTXO2])
        const storage2 = new MockStorage()
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage2.findKnownUTXOs(0)).length).toBe(2)
        expect(await storage2.findKnownUTXOs(0)).toEqual(await storage1.findKnownUTXOs(0))
    })
    it('Synchronizes a graph with recursive inputs from Bob to Alice', async () => {
        const recursiveInputNode = {
            graphID: 'recursive_txid.1',
            rawTx: 'recursive_rawtx',
            outputIndex: 1,
            time: 333,
            txid: 'recursive_txid',
            inputs: {}
        }

        const complexUTXOWithInput = {
            ...mockUTXOWithInput,
            inputs: {
                ...mockUTXOWithInput.inputs,
                'recursive_txid.1': recursiveInputNode
            }
        }

        const storage1 = new MockStorage()
        storage1.findNeededInputs = jest.fn().mockImplementationOnce(async (n: GASPNode): Promise<GASPNodeResponse> => {
            return {
                requestedInputs: {
                    'mock_sender1_txid2.0': {
                        metadata: true
                    }
                }
            }
        }).mockImplementationOnce(async (n: GASPNode): Promise<GASPNodeResponse> => {
            return {
                requestedInputs: {
                    'recursive_txid.1': {
                        metadata: true
                    }
                }
            }
        })
        const storage2 = new MockStorage([complexUTXOWithInput])
        storage2.hydrateGASPNode = jest.fn()
            .mockReturnValueOnce(mockUTXO)
            .mockReturnValueOnce(mockInputNode)
            .mockReturnValueOnce(recursiveInputNode)
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage1.findKnownUTXOs(0)).length).toBe(1)
        expect(await storage1.findKnownUTXOs(0)).toEqual(await storage2.findKnownUTXOs(0))
    })
    it('Synchronizes only UTXOs created after the specified since timestamp', async () => {
        const oldUTXO = {
            graphID: 'old_txid.0',
            rawTx: 'old_rawtx',
            outputIndex: 0,
            time: 100,
            txid: 'old_txid',
            inputs: {}
        }

        const newUTXO = {
            graphID: 'new_txid.1',
            rawTx: 'new_rawtx',
            outputIndex: 1,
            time: 200,
            txid: 'new_txid',
            inputs: {}
        }

        const storage1 = new MockStorage([oldUTXO, newUTXO])
        const storage2 = new MockStorage()
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 150, '[GASP #2] ') // Setting the `since` timestamp to 150
        gasp1.remote = gasp2
        await gasp1.sync()

        // Ensure only the new UTXO is synchronized
        const syncedUTXOs = await storage2.findKnownUTXOs(0)
        expect(syncedUTXOs.length).toBe(1)
        expect(syncedUTXOs).toEqual([{ txid: 'new_txid', outputIndex: 1 }])
    })
    it('Will not sync unnecessary graphs', async () => {
        const storage1 = new MockStorage([mockUTXO])
        const storage2 = new MockStorage([mockUTXO])
        const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
        const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
        gasp1.remote = gasp2
        await gasp1.sync()
        expect((await storage1.findKnownUTXOs(0)).length).toBe(1)
        expect((await storage2.findKnownUTXOs(0)).length).toBe(1)
        expect(storage1.finalizeGraph).not.toHaveBeenCalled()
        expect(storage2.finalizeGraph).not.toHaveBeenCalled()
        expect(await storage2.findKnownUTXOs(0)).toEqual(await storage1.findKnownUTXOs(0))
    })
})
