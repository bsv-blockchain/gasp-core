/**
 * Represents the initial request made under the Graph Aware Sync Protocol.
 */
type GASPInitialRequest = {
  /** GASP version. Currently 1. */
  version: number
  /** A variable-length bloom filter representing the list of UTXOs currently known by the sender of this request. */
  UTXOBloom: string
}

/**
 * Represents an output, its encompassing transaction, and the associated metadata, together with references to inputs and their metadata.
 */
type GASPNode = {
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
type GASPNodeResponse = {
  requestedInputs: Record<string, { metadata: boolean }>
}

/**
 * Facilitates the finding of UTXOs, determination of needed inputs, temporary graph management, and eventual graph finalization.
 */
interface GASPStorage {
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

interface GASPRemote {
  getInitialResponse: (request: GASPInitialRequest) => Promise<GASPNode[]>
  requestNode: (txid: string, outputIndex: number, metadata: boolean) => Promise<GASPNode>
  getFilter: () => Promise<string>
  submitNode: (node: GASPNode) => Promise<GASPNodeResponse>
}

class GASPVersionMismatchError extends Error {
  code: 'ERR_GASP_VERSION_MISMATCH'
  currentVersion: number
  foreignVersion: number
}

class GASP {
  version: number
  storage: GASPStorage
  remote: GASPRemote

  constructor (storage: GASPStorage, remote: GASPRemote) {
    this.storage = storage
    this.remote = remote
    this.version = 1
  }

  /**
   * Returns a bloom filter based on the set of elements.
   */
  private calculateBloomFilter(txs: Array<{ txid: string, outputIndex: number }>): string {
    return ''
  }

  /**
   * Returns true if the element is definitely not in the filter. If it returns false, the element is probably in the filter, but it might not be.
   */
  private checkFilterExclusion(filter: string, txid: string, outputIndex: number): boolean {
    return true
  }

  /**
   * Computes the 36-byte representation by converting the number into a 4-byte string that is appended to the TXID.
   */
  private compute36ByteStructure(txid: string, index: number): string {
    return ''
  }

  private deconstruct36ByteStructure(outpoint: string): { txid: string, index: number } {
    return {
      txid: '',
      index: 0
    }
  }

  private computeTXID(tx: string): string {
    return ''
  }

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

  async buildInitialRequest(): Promise<GASPInitialRequest> {
    const knownUTXOs = await this.storage.findKnownUTXOs()
    const filter = this.calculateBloomFilter(knownUTXOs)
    return {
      version: this.version,
      UTXOBloom: filter
    }
  }

  async buildInitialResponse(request: GASPInitialRequest): Promise<GASPNode[]> {
    if (request.version !== this.version) {
      const e = new GASPVersionMismatchError(`GASP version mismatch. Current version: ${this.version}, foreign version: ${request.version}`)
      e.code = 'ERR_GASP_VERSION_MISMATCH'
      e.currentVersion = this.version
      e.foreignVersion = request.version
      throw e
    }
    return await this.getSyncUTXOsForFilter(request.UTXOBloom)
  }

  async getSyncUTXOsForFilter(filter: string): Promise<GASPNode[]> {
    const knownUTXOs = await this.storage.findKnownUTXOs()
    const syncUTXOs: GASPNode[] = []
    await Promise.all(knownUTXOs.map(async known => {
      const notInFilter = this.checkFilterExclusion(
        filter,
        known.txid,
        known.outputIndex
      )
      if (notInFilter) {
        const node = await this.storage.hydrateGASPNode(
          known.txid,
          known.outputIndex,
          true
        )
        syncUTXOs.push(node)
      }
    }))
    return syncUTXOs
  }

  async processIncomingNode(node: GASPNode, spentBy?: string): Promise<void> {
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
      this.processIncomingNode(
        newNode,
        this.compute36ByteStructure(
          this.computeTXID(node.tx),
          node.outputIndex
        )
      )
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

  async processOutgoingNode(node: GASPNode): Promise<void> {
    const response = await this.remote.submitNode(node)
    await Promise.all(Object.entries(response.requestedInputs).map(async ([outpoint, { metadata }]) => {
      const { txid, index } = this.deconstruct36ByteStructure(outpoint)
      const hydratedNode = await this.storage.hydrateGASPNode(txid, index, metadata)
      await this.processOutgoingNode(hydratedNode)
    }))
  }
}