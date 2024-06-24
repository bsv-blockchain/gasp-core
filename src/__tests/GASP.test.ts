/* eslint-env jest */
import { GASP, GASPInitialRequest, GASPNode, GASPNodeResponse, GASPStorage, GASPRemote, GASPInitialReply, GASPInitialResponse } from '../GASP'

type Graph = {
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

    constructor(knownStore: Array<Graph> = [], tempGraphStore: Record<string, Graph> = {}, updateCallback: Function = () => { }) {
        this.knownStore = knownStore
        this.tempGraphStore = tempGraphStore
        this.updateCallback = updateCallback
    }

    async findKnownUTXOs(since: number): Promise<{ txid: string; outputIndex: number }[]> {
        const utxos = this.knownStore
            .filter(x => !x.time || x.time > since) // Include UTXOs with no timestamp or timestamps greater than 'since'
            .map(x => ({ txid: x.txid, outputIndex: x.outputIndex }))
        console.log('[Storage] findKnownUTXOs', since, utxos)
        return utxos
    }

    async hydrateGASPNode(graphID: string, txid: string, outputIndex: number, metadata: boolean): Promise<GASPNode> {
        const found = this.knownStore.find(x => x.txid === txid && x.outputIndex === outputIndex)
        if (!found) {
            throw new Error('Not found')
        }
        console.log('[Storage] hydrateGASPNode', graphID, txid, outputIndex, metadata, found)
        return {
            graphID,
            rawTx: found.rawTx,
            outputIndex: found.outputIndex
        }
    }

    async findNeededInputs(tx: GASPNode): Promise<void | GASPNodeResponse> {
        console.log('[Storage] findNeededInputs', tx)
        // For testing, assume no additional inputs are needed
        return
    }

    async appendToGraph(tx: GASPNode, spentBy?: string | undefined): Promise<void> {
        console.log('[Storage] appendToGraph', tx, spentBy)
        this.tempGraphStore[tx.graphID] = {
            ...tx,
            time: 111,
            txid: 'mock_sender1_txid1',
            inputs: {}
        }
    }

    async validateGraphAnchor(graphID: string): Promise<void> {
        console.log('[Storage] validateGraphAnchor', graphID)
        // Allow validation to pass
    }

    async discardGraph(graphID: string): Promise<void> {
        console.log('[Storage] discardGraph', graphID)
        delete this.tempGraphStore[graphID]
    }

    async finalizeGraph(graphID: string): Promise<void> {
        const tempGraph = this.tempGraphStore[graphID]
        if (tempGraph) {
            console.log('[Storage] finalizeGraph', graphID, tempGraph)
            this.knownStore.push(tempGraph)
            this.updateCallback()
            delete this.tempGraphStore[graphID]
        } else {
            console.log('[Storage] no graph to finalize', graphID, tempGraph)
        }
    }
}

const mockUTXO = {
    rawTx: 'mock_sender1_rawtx1',
    outputIndex: 0,
    time: 111,
    txid: 'mock_sender1_txid1',
    inputs: {}
}

describe('GASP', () => {
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
})
