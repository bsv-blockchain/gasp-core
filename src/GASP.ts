import { Transaction } from '@bsv/sdk'

/**
 * Represents the initial request made under the Graph Aware Sync Protocol.
 */
export type GASPInitialRequest = {
  /** GASP version. Currently 1. */
  version: number
  /** A variable-length bloom filter representing the list of UTXOs currently known by the sender of this request. */
  UTXOBloom: string
}

/**
 * Represents an output, its encompassing transaction, and the associated metadata, together with references to inputs and their metadata.
 */
export type GASPNode = {
  /** The graph ID to which this node belongs. */
  graphID: string
  /** The Bitcoin transaction. */
  tx: string
  /** The index of the output in the transaction. */
  outputIndex: number
  /** A BUMP proof for the transaction, if it is in a block. */
  proof?: string
  /** Metadata associated with the transaction, if it was requested. */
  txMetadata?: string
  /** Metadata associated with the output, if it was requested. */
  outputMetadata?: string
  /** A mapping of transaction inputs to metadata hashes, if metadata was requested. */
  inputs?: Record<string, { hash: string }>
}

/**
 * Denotes which input transactions are requeste, and whether metadata needs to be sent.
 */
export type GASPNodeResponse = {
  requestedInputs: Record<string, { metadata: boolean }>
}

/**
 * Facilitates the finding of UTXOs, determination of needed inputs, temporary graph management, and eventual graph finalization.
 */
export interface GASPStorage {
  /**
   * Returns an array of transaction outpoints that are currently known to be unspent.
   * @returns A promise for an array of objects, each containing txid and outputIndex properties.
   */
  findKnownUTXOs: () => Promise<Array<{ txid: string, outputIndex: number }>>
  /**
   * For a given txid and output index, returns the associated transaction, a merkle proof if the transaction is in a block, and metadata if if requested. If no metadata is requested, metadata hashes on inputs are not returned.
   * @param txid The transaction ID for the node to hydrate.
   * @param outputIndex The output index for the node to hydrate.
   * @param metadata Whether transaction and output metadata should be returned.
   * @returns The hydrated GASP node, with or without metadata.
   */
  hydrateGASPNode: (txid: string, outputIndex: number, metadata: boolean) => Promise<GASPNode>
  /**
   * For a given node, returns the inputs needed to complete the graph, including whether updated metadata is requested for those inputs.
   * @param tx The node for which needed inputs should be found.
   * @returns A promise for a mapping of requested input transactions and whether metadata should be provided for each.
  */
  findNeededInputs: (tx: GASPNode) => Promise<GASPNodeResponse>
  /**
   * Appends a new node to a temporary graph.
   * @param tx The node to append to this graph.
   * @param spentBy Unless this is the same node identified by the graph ID, denotes the TXID and input index for the node which spent this one, in 36-byte format.
   * @throws If the node cannot be appended to the graph, either because the graph ID is for a graph the recipient does not want or because the graph has grown to be too large before being finalized.
  */
  appendToGraph: (tx: GASPNode, spentBy?: string) => Promise<void>
  /**
   * Checks whether the given graph, in its current state, makes reference only to transactions that are proven in the blockchain, or already known by the recipient to be valid.
   * @param graphID The TXID and output index (in 36-byte format) for the UTXO at the tip of this graph.
   * @throws If the graph is not well-anchored.
   */
  validateGraphAnchor: (graphID: string) => Promise<void>
  /**
   * Deletes all data associated with a temporary graph that has failed to sync, if the graph exists.
   * @param graphID The TXID and output index (in 36-byte format) for the UTXO at the tip of this graph.
   */
  discardGraph: (graphID: string) => Promise<void>
  /**
   * Finalizes a graph, solidifying the new UTXO and its ancestors so that it will appear in the list of known UTXOs.
   * @param graphID The TXID and output index (in 36-byte format) for the UTXO at the tip of this graph.
   */
  finalizeGraph: (graphID: string) => Promise<void>
}

export interface GASPRemote {
  getInitialResponse: (request: GASPInitialRequest) => Promise<GASPNode[]>
  requestNode: (txid: string, outputIndex: number, metadata: boolean) => Promise<GASPNode>
  getFilter: () => Promise<string>
  submitNode: (node: GASPNode) => Promise<GASPNodeResponse>
}

export class GASPVersionMismatchError extends Error {
  code: 'ERR_GASP_VERSION_MISMATCH'
  currentVersion: number
  foreignVersion: number

  constructor(message: string, currentVersion: number, foreignVersion: number) {
    super(message)
    this.code = 'ERR_GASP_VERSION_MISMATCH'
    this.currentVersion = currentVersion
    this.foreignVersion = foreignVersion
  }
}

/**
 * Main class implementing the Graph Aware Sync Protocol.
 */
export class GASP {
  version: number
  storage: GASPStorage
  remote: GASPRemote

  constructor(storage: GASPStorage, remote: GASPRemote) {
    this.storage = storage
    this.remote = remote
    this.version = 1
  }

  /**
  * Calculates a bloom filter for a set of UTXOs.
  * @param txs The array of UTXOs to include in the bloom filter.
  * @returns A string representing the bloom filter.
  */
  private calculateBloomFilter(txs: Array<{ txid: string, outputIndex: number }>): string {
    // Bloom filter calculation logic (simplified for brevity)
    return txs.map(tx => `${tx.txid}:${tx.outputIndex}`).join(',') // TODO: Implement properly
  }

  /**
   * Checks if a UTXO is excluded from the bloom filter.
   * @param filter The bloom filter string.
   * @param txid The transaction ID of the UTXO.
   * @param outputIndex The output index of the UTXO.
   * @returns True if the UTXO is not in the filter, false otherwise.
   */
  private checkFilterExclusion(filter: string, txid: string, outputIndex: number): boolean {
    // Check if the txid and outputIndex are in the filter
    return !filter.includes(`${txid}:${outputIndex}`) // TODO: Implement properly
  }

  /**
   * Computes a 36-byte structure from a transaction ID and output index.
   * @param txid The transaction ID.
   * @param index The output index.
   * @returns A string representing the 36-byte structure.
   */
  private compute36ByteStructure(txid: string, index: number): string {
    return `${txid}:${index.toString().padStart(4, '0')}`
  }

  /**
   * Deconstructs a 36-byte structure into a transaction ID and output index.
   * @param outpoint The 36-byte structure.
   * @returns An object containing the transaction ID and output index.
   */
  private deconstruct36ByteStructure(outpoint: string): { txid: string, index: number } {
    const [txid, index] = outpoint.split(':')
    return {
      txid,
      index: parseInt(index, 10)
    }
  }

  /**
   * Computes the transaction ID for a given transaction.
   * @param tx The transaction string.
   * @returns The computed transaction ID.
   */
  private computeTXID(tx: string): string {
    return Transaction.fromHex(tx).id('hex')
  }

  /**
   * Synchronizes the transaction data between the local and remote participants.
   */
  async sync(): Promise<void> {
    const initialRequest = await this.buildInitialRequest()
    const remoteUTXOs = await this.remote.getInitialResponse(initialRequest)
    await Promise.all(remoteUTXOs.map(async remote => {
      await this.processIncomingNode(remote)
    }))
    const filter = await this.remote.getFilter()
    const syncUTXOs = await this.getSyncUTXOsForFilter(filter)
    await Promise.all(syncUTXOs.map(async sync => {
      await this.processOutgoingNode(sync)
    }))
  }

  /**
  * Builds the initial request for the sync process.
  * @returns A promise for the initial request object.
  */
  async buildInitialRequest(): Promise<GASPInitialRequest> {
    const knownUTXOs = await this.storage.findKnownUTXOs()
    const filter = this.calculateBloomFilter(knownUTXOs)
    return {
      version: this.version,
      UTXOBloom: filter
    }
  }

  /**
   * Builds the initial response based on the received request.
   * @param request The initial request object.
   * @returns A promise for an array of GASP nodes.
   */
  async buildInitialResponse(request: GASPInitialRequest): Promise<GASPNode[]> {
    if (request.version !== this.version) {
      throw new GASPVersionMismatchError(`GASP version mismatch. Current version: ${this.version}, foreign version: ${request.version}`, this.version, request.version)
    }
    return await this.getSyncUTXOsForFilter(request.UTXOBloom)
  }

  /**
   * Gets the sync UTXOs that are not included in the provided bloom filter.
   * @param filter The bloom filter string.
   * @returns A promise for an array of GASP nodes.
   */
  async getSyncUTXOsForFilter(filter: string): Promise<GASPNode[]> {
    const knownUTXOs = await this.storage.findKnownUTXOs()
    const syncUTXOs: GASPNode[] = []
    await Promise.all(knownUTXOs.map(async known => {
      const notInFilter = this.checkFilterExclusion(filter, known.txid, known.outputIndex)
      if (notInFilter) {
        const node = await this.storage.hydrateGASPNode(known.txid, known.outputIndex, true)
        syncUTXOs.push(node)
      }
    }))
    return syncUTXOs
  }

  /**
   * Processes an incoming node from the remote participant.
   * @param node The incoming GASP node.
   * @param spentBy The 36-byte structure of the node that spent this one, if applicable.
   */
  async processIncomingNode(node: GASPNode, spentBy?: string, seenNodes = new Set()): Promise<void> {
    const nodeId = `${node.tx}:${node.outputIndex}`
    if (seenNodes.has(nodeId)) return // Prevent infinite recursion
    seenNodes.add(nodeId)
    try {
      await this.storage.appendToGraph(node, spentBy)
    } catch (e) {
      await this.storage.discardGraph(node.graphID)
      throw e
    }
    const neededInputs = await this.storage.findNeededInputs(node)
    await Promise.all(Object.entries(neededInputs.requestedInputs).map(async ([outpoint, { metadata }]) => {
      const { txid, index } = this.deconstruct36ByteStructure(outpoint)
      const newNode = await this.remote.requestNode(txid, index, metadata)
      await this.processIncomingNode(newNode, this.compute36ByteStructure(this.computeTXID(node.tx), node.outputIndex), seenNodes)
    }))
    if (typeof spentBy === 'undefined') {
      try {
        await this.storage.validateGraphAnchor(node.graphID)
      } catch (e) {
        await this.storage.discardGraph(node.graphID)
        throw e
      }
      await this.storage.finalizeGraph(node.graphID)
    }
  }

  /**
   * Processes an outgoing node to the remote participant.
   * @param node The outgoing GASP node.
   */
  async processOutgoingNode(node: GASPNode, seenNodes = new Set()): Promise<void> {
    const nodeId = `${node.tx}:${node.outputIndex}`
    if (seenNodes.has(nodeId)) return // Prevent infinite recursion
    seenNodes.add(nodeId)
    const response = await this.remote.submitNode(node)
    await Promise.all(Object.entries(response.requestedInputs).map(async ([outpoint, { metadata }]) => {
      const { txid, index } = this.deconstruct36ByteStructure(outpoint)
      const hydratedNode = await this.storage.hydrateGASPNode(txid, index, metadata)
      await this.processOutgoingNode(hydratedNode, seenNodes)
    }))
  }
}
