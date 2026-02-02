declare module '@apify/storage-local' {
  interface ApifyStorageLocalOptions {
    storageDir?: string
    enableWalMode?: boolean
  }

  export class ApifyStorageLocal {
    constructor(options?: ApifyStorageLocalOptions)
  }
}
