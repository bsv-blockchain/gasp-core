/* eslint-env jest */
import { GASP, GASPInitialRequest, GASPNode, GASPNodeResponse, GASPStorage, GASPRemote, GASPInitialReply, GASPInitialResponse } from '../GASP'

type Graph = {
    time: number,
    txid: string,
    outputIndex: number,
    rawTx: string,
    inputs: Record<string, Graph>
}

const syncTwoStorages = async (storage1: GASPStorage, storage2: GASPStorage): Promise<void> => {
    const throwawayRemote: GASPRemote = {
        getInitialResponse: async function (request: GASPInitialRequest): Promise<GASPInitialResponse> {
            console.log('getInitialResponse called with request:', request)
            const response = await storage1.findKnownUTXOs(request.since)
            console.log('getInitialResponse response:', response)
            return {
                UTXOList: response,
                since: Date.now()
            }
        },
        getInitialReply: async function (response: GASPInitialResponse): Promise<GASPInitialReply> {
            console.log('getInitialReply called with response:', response)
            const reply = await storage1.findKnownUTXOs(response.since)
            console.log('getInitialReply reply:', reply)
            return {
                UTXOList: reply.filter(x => !response.UTXOList.some(y => y.txid === x.txid && y.outputIndex === x.outputIndex))
            }
        },
        requestNode: async function (graphID: string, txid: string, outputIndex: number, metadata: boolean): Promise<GASPNode> {
            console.log('requestNode called with:', { graphID, txid, outputIndex, metadata })
            const node = await storage1.hydrateGASPNode(graphID, txid, outputIndex, metadata)
            console.log('requestNode response:', node)
            return node
        },
        submitNode: async function (node: GASPNode): Promise<void | GASPNodeResponse> {
            console.log('submitNode called with:', node)
            const response = await storage1.appendToGraph(node)
            console.log('submitNode response:', response)
            return response
        }
    }
    const gasp1 = new GASP(storage1, throwawayRemote, 0, '[GASP #1] ')
    const gasp2 = new GASP(storage2, gasp1, 0, '[GASP #2] ')
    gasp1.remote = gasp2
    console.log('Starting sync')
    await gasp1.sync()
    console.log('Sync completed')
}

const makeStorageForVariables = (
    knownStore: Array<Graph>,
    tempGraphStore: Record<string, Graph>,
    updateCallback: () => void
): GASPStorage => {
    return {
        findKnownUTXOs: async function (since: number): Promise<{ txid: string; outputIndex: number }[]> {
            const utxos = knownStore.filter(x => x.time > since).map(x => ({ txid: x.txid, outputIndex: x.outputIndex }))
            console.log('findKnownUTXOs', since, utxos)
            return utxos
        },
        hydrateGASPNode: async function (graphID: string, txid: string, outputIndex: number, metadata: boolean): Promise<GASPNode> {
            const found = knownStore.find(x => x.txid === txid && x.outputIndex === outputIndex)
            if (!found) {
                throw new Error('Not found')
            }
            console.log('hydrateGASPNode', graphID, txid, outputIndex, metadata, found)
            return {
                graphID,
                rawTx: found.rawTx,
                outputIndex: found.outputIndex
            }
        },
        findNeededInputs: async function (tx: GASPNode): Promise<void | GASPNodeResponse> {
            console.log('findNeededInputs', tx)
            // For testing, assume no additional inputs are needed
            return
        },
        appendToGraph: async function (tx: GASPNode, spentBy?: string | undefined): Promise<void> {
            console.log('appendToGraph', tx, spentBy)
            tempGraphStore[tx.graphID] = {
                ...tx,
                time: 111,
                txid: 'mock_txid_' + tx.rawTx,
                inputs: {}
            }
        },
        validateGraphAnchor: async function (graphID: string): Promise<void> {
            console.log('validateGraphAnchor', graphID)
            // Allow validation to pass
        },
        discardGraph: async function (graphID: string): Promise<void> {
            console.log('discardGraph', graphID)
            delete tempGraphStore[graphID]
        },
        finalizeGraph: async function (graphID: string): Promise<void> {
            const tempGraph = tempGraphStore[graphID]
            if (tempGraph) {
                console.log('finalizeGraph', graphID, tempGraph)
                knownStore.push(tempGraph)
                updateCallback()
                delete tempGraphStore[graphID]
            }
        }
    }
}

describe('GASP', () => {
    it('Synchronizes a single UTXO from Alice to Bob', async () => {
        let party1known: Array<Graph> = [
            {
                rawTx: 'mock_sender1_rawtx1',
                outputIndex: 0,
                time: 111,
                txid: 'mock_sender1_txid1',
                inputs: {}
            }
        ]
        let party2known: Array<Graph> = []
        const storage1 = makeStorageForVariables(party1known, {}, () => {
            console.log('Updated party1known:', party1known)
        })
        const storage2 = makeStorageForVariables(party2known, {}, () => {
            console.log('Updated party2known:', party2known)
            party2known = [...party2known] // Trigger reactivity
        })
        await syncTwoStorages(storage1, storage2)

        // Log the final state of party2known for debugging
        console.log('Final state of party2known:', party2known)

        // Expected known state after synchronization
        const expectedKnown = [
            {
                rawTx: 'mock_sender1_rawtx1',
                outputIndex: 0,
                time: 111,
                txid: 'mock_sender1_txid1',
                inputs: {}
            }
        ]

        expect(party2known).toEqual(expectedKnown)
    })
})
