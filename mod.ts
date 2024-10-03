import axios, { type AxiosResponse } from "npm:axios@1.7.7";
import { defu } from "npm:defu@6.1.4";

/**
 * Create an atomic operation. Atomic operations allow you to perform multiple
 * operations in a single transaction.
 */
export class AtomicOperation {
    private checks: AtomicCheck[] = [];
    private operations: KvOperation[] = [];

    constructor(private url: string, private options: KvOptions) {}

    /**
     * Add a check to the atomic operation.
     *
     * @param checks - The checks to perform
     *
     * @example
     * ```ts
     * const key = ['users', 'ghostzero']
     * const res = await kv.atomic()
     *    .check({key, version: null}) // `null` version mean 'no value'
     *    .set(key, {name: 'GhostZero'})
     *    .commit()
     *
     * console.log(res.ok)
     * ```
     */
    check(...checks: AtomicCheck[]): this {
        this.checks.push(...checks);
        return this;
    }

    /**
     * Set a value in the key-value store.
     *
     * @param key - The key of the entry
     * @param value - The value of the entry
     */
    set<T extends KvValue = KvValue>(key: KvKey, value: T): this {
        this.operations.push({ type: "set", key, value, encrypted: false });
        return this;
    }

    /**
     * Delete a value from the key-value store.
     *
     * @param key - The key of the entry
     */
    delete(key: KvKey): this {
        this.operations.push({ type: "delete", key });
        return this;
    }

    /**
     * Commit the atomic operation.
     */
    async commit(): Promise<KvCommitResult> {
        // Encrypt the values in operations if `encrypted` is false
        const operationsToSend: KvOperation[] = await Promise.all(
            this.operations.map(
                async (operation: KvOperation): Promise<KvOperation> => {
                    if (
                        operation.type === "set" && !operation.encrypted &&
                        this.options.keyManager?.shouldEncrypt(operation.key)
                    ) {
                        const encryptedValue = await encryptData(
                            this.options.keyManager,
                            operation.value,
                        );
                        return {
                            ...operation,
                            value: encryptedValue,
                            encrypted: true, // Mark as encrypted
                        };
                    }
                    return operation; // Return as-is for non-encrypted operations
                },
            ),
        );

        // Send the atomic operation request
        const { data } = await axios.post(`${this.url}/atomic`, {
            checks: this.checks,
            operations: operationsToSend,
        }, {
            headers: this.options.headers,
        });

        return data;
    }
}

/**
 * Connect to the simple key-value store.
 *
 * @param options - The options to use when connecting
 *
 * @example
 * ```ts
 * const kv = connect({
 *    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
 *    accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
 * })
 *
 * const key = ['users', 'ghostzero']
 * const res = await kv.set(key, {name: 'GhostZero'})
 *
 * console.log(res.value.name) // GhostZero
 * ```
 */
export async function connect(options: KvOptions = {}): Promise<Kv> {
    const env = getEnv(options.ignoreEnv);
    const _options = defu(options, {
        accessToken: env.KV_ACCESS_TOKEN,
        endpoint: env.KV_ENDPOINT,
        bucket: env.KV_BUCKET,
        region: env.KV_REGION ?? "eu-central-1",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${options.accessToken}`,
        },
    } as KvOptions);
    if (!_options.bucket) {
        throw new Error("The `bucket` option is required");
    }
    if (!_options.accessToken) {
        throw new Error("The `accessToken` option is required");
    }
    const url: string = !_options.endpoint
        ? `https://kv.${_options.region}.kv-db.dev/v1/${_options.bucket}`
        : `${_options.endpoint}/v1/${_options.bucket}`;
    _options.endpoint = url;
    return {
        options: _options,
        async get<T = KvValue>(key: KvKey): Promise<Entry<T>> {
            const { data } = await axios.get(`${url}/${key.join("/")}`, {
                headers: _options.headers,
            }) as AxiosResponse<Entry<T>>;

            let value: T = data.value;

            if (data.encrypted) {
                if (!_options.keyManager?.shouldEncrypt(key)) {
                    throw new Error(
                        "Encrypted value received but no key manager available",
                    );
                }
                if (typeof data.value !== "object") {
                    throw new Error(
                        "Encrypted value received but value is not a object",
                    );
                }

                value = await decryptData<T>(
                    _options.keyManager,
                    value as EncryptedKvValue,
                );
            }

            return {
                key: data.key,
                value: value as T,
                version: data.version,
                encrypted: data.encrypted,
            };
        },
        async getMany<T = KvValue>(
            keys: KvKey[],
        ): Promise<Entry<T>[]> {
            const kvInstance = await this;
            return Promise.all(
                keys.map((key: KvKey) =>
                    kvInstance.get(key) as Promise<Entry<T>>
                ),
            );
        },
        async list<T = KvValue>(
            selector: KvListSelector,
        ): Promise<KvListIterator<T>> {
            const response: AxiosResponse<Entry<T>[]> = await axios.get(url, {
                params: selector,
                headers: _options.headers,
            });

            return {
                [Symbol.asyncIterator]: async function* () {
                    for (const entry of response.data) {
                        let decryptedValue: T = entry.value;

                        // Check if the entry is encrypted and decrypt it
                        if (entry.encrypted) {
                            if (
                                !_options.keyManager?.shouldEncrypt(entry.key)
                            ) {
                                throw new Error(
                                    "Encrypted value received but no key manager available",
                                );
                            }
                            if (typeof entry.value !== "object") {
                                throw new Error(
                                    "Encrypted value received but value is not a object",
                                );
                            }
                            decryptedValue = await decryptData<T>(
                                _options.keyManager,
                                entry.value as EncryptedKvValue,
                            );
                        }

                        yield {
                            ...entry,
                            value: decryptedValue,
                        };
                    }
                },
            } as KvListIterator<T>;
        },
        async set<T = KvValue>(key: KvKey, value: T): Promise<Entry<T>> {
            let encryptedValue: KvValue | T = value;
            if (_options.keyManager?.shouldEncrypt(key)) {
                encryptedValue = await encryptData(
                    _options.keyManager,
                    value as KvValue,
                );
            }

            const { data } = await axios.put(`${url}/${key.join("/")}`, {
                value: encryptedValue,
                encrypted: !!_options.keyManager?.shouldEncrypt(key),
            }, {
                headers: _options.headers,
            }) as AxiosResponse<Entry<T>>;

            if (data.encrypted) {
                return {
                    key,
                    value,
                    version: data.version,
                    encrypted: true,
                };
            }

            return data;
        },
        atomic(): AtomicOperation {
            return new AtomicOperation(url, _options);
        },
        async delete(key: KvKey): Promise<boolean> {
            return await fetch(`${url}/${key.join("/")}`, {
                method: "DELETE",
                headers: _options.headers,
            }).then((response): void => {
                if (!response.ok) {
                    throw new Error("Failed to delete value");
                }
                if (response.body) {
                    response.body.cancel();
                }
            }).then((): boolean => true);
        },
    };
}

/**
 * Find environment variables by either checking process.env or Deno.env.
 */
function getEnv(
    ignoreEnv: boolean | undefined,
): Record<string, string> {
    if (ignoreEnv) {
        return {};
    }
    // @ts-ignore
    if (typeof process !== "undefined" && process.env) {
        // @ts-ignore
        return process.env;
    }
    if (typeof Deno !== "undefined" && Deno.env) {
        return Deno.env.toObject();
    }
    return {};
}

/**
 * Generate a random Initialization Vector for AES-GCM.
 */
function generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for GCM
}

/**
 * Encrypt data using the provided key.
 *
 * @param keyManager - The key manager to use for encryption
 * @param data - The data to encrypt
 */
async function encryptData(
    keyManager: KeyManager,
    data: KvValue,
): Promise<KvValue> {
    const jwk = keyManager.getActiveKey();
    const iv = generateIV();
    const encodedData = new TextEncoder().encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        jwk.key,
        encodedData,
    );

    const ct = btoa(String.fromCharCode(...new Uint8Array(encrypted)));

    return { ct, iv, kid: jwk.kid };
}

/**
 * Decrypt data using the provided key.
 *
 * @param keyManager - The key manager to use for decryption
 * @param data - The data to decrypt (contains ct and IV)
 * @returns The decrypted KvValue object
 */
async function decryptData<T = KvValue>(
    keyManager: KeyManager,
    data: EncryptedKvValue,
): Promise<T> {
    const key = keyManager.getKey(data.kid);
    const encryptedData = new Uint8Array(
        Array.from(atob(data.ct), (c) => c.charCodeAt(0)),
    );

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(data.iv) },
            key,
            encryptedData,
        );

        const decoded = new TextDecoder().decode(decrypted);
        return JSON.parse(decoded);
    } catch (error) {
        throw new Error("Failed to decrypt value");
    }
}

/**
 * Generate a new CryptoKey for encryption and decryption.
 */
export async function generateCryptoKey(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"],
    );
}

/**
 * Export a CryptoKey to a base64 string representation.
 *
 * Returns a JSON Web Key (JWK) string.
 *
 * @param key - The key to export
 * @param kid - The key ID to use
 */
export async function exportCryptoKey(
    key: CryptoKey,
    kid?: string,
): Promise<string> {
    const rawKey = await crypto.subtle.exportKey("raw", key);
    const keyBuffer = new Uint8Array(rawKey);
    return btoa(JSON.stringify({
        kty: "oct",
        k: btoa(String.fromCharCode(...keyBuffer)),
        kid: kid ?? Math.random().toString(36).substring(7),
    } as Jwk));
}

/**
 * Import a CryptoKey from a base64 string representation.
 *
 * Returns a JwtCryptoKey object with the CryptoKey and JWK properties.
 *
 * @param base64Key - The base64 string to import
 */
export async function importCryptoKey(
    base64Key: string,
): Promise<JwtCryptoKey> {
    const jwk = JSON.parse(atob(base64Key)) as Jwk;
    const rawKey = new Uint8Array(
        Array.from(atob(jwk.k), (c) => c.charCodeAt(0)),
    );
    const key = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM" },
        true, // Extractable key
        ["encrypt", "decrypt"], // Usage for encryption and decryption
    );
    return { ...jwk, key };
}

/**
 * @module
 *
 * This module provides a simple key-value store client for Deno and other JavaScript/TypeScript runtimes.
 */
export interface Kv {
    /**
     * The resolved options used by the key-value store.
     */
    options: KvOptions;

    /**
     * Get an entry from the key-value store.
     *
     * @param key - The key of the entry
     */
    get<T = KvValue>(key: KvKey): Promise<Entry<T>>;

    /**
     * Get multiple entries from the key-value store.
     *
     * @param keys - The keys of the entries
     */
    getMany<T = KvValue>(keys: KvKey[]): Promise<Entry<T>[]>;

    /**
     * List entries from the key-value store.
     *
     * @param selector - The selector to use when listing entries
     */
    list<T = KvValue>(selector: KvListSelector): Promise<KvListIterator<T>>;

    /**
     * Set an entry in the key-value store.
     *
     * @param key - The key of the entry
     * @param value - The value of the entry
     */
    set<T = KvValue>(key: KvKey, value: T): Promise<Entry<T>>;

    /**
     * Create an atomic operation.
     */
    atomic(): AtomicOperation;

    /**
     * Delete an entry from the key-value store.
     *
     * @param key - The key of the entry
     */
    delete(key: KvKey): Promise<boolean>;
}

/**
 * Key manager for managing encryption keys.
 *
 * This class allows you to manage encryption keys for encrypting and decrypting values in the key-value store.
 *
 * @example
 * ```ts
 * const keyManager = await new KeyManager().fromEnv();
 *
 * const kv = await connect({ keyManager });
 * ```
 *
 * @example
 * ```ts
 * const keyManager = new KeyManager();
 * await keyManager.addKey('aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1kUXc0dzlXZ1hjUQ==', true);
 *
 * const kv = await connect({ keyManager });
 * ```
 */
export class KeyManager {
    private keys: JwtCryptoKey[] = [];
    private activeKid: string = "";
    private exceptKvKeys: KvKey[] = [];
    private onlyKvKeys: KvKey[] = [];

    constructor() {}

    /**
     * Add a key to the key manager.
     *
     * The key can be a JwtCryptoKey object or a base64 string representation of a key.
     *
     * **Note:** The `kid` property is required for the key.
     *
     * @param jwk - A JwtCryptoKey or base64 string to add
     * @param active - Whether the key should be set as active
     *
     * @example
     * ```ts
     * const keyManager = new KeyManager();
     * await keyManager.addKey('aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1kUXc0dzlXZ1hjUQ==', true);
     * ```
     */
    async addKey(
        jwk: JwtCryptoKey | string,
        active: boolean,
    ): Promise<this> {
        if (typeof jwk === "string") {
            jwk = await importCryptoKey(jwk);
        }
        if (!jwk.kid) {
            throw new Error("The `kid` property is required");
        }

        this.keys.push(jwk);

        if (active) {
            this.setActiveKey(jwk);
        }

        return this;
    }

    /**
     * Get a key by its key ID (kid).
     *
     * @param kid
     */
    getKey(kid: string): CryptoKey {
        const key = this.keys.find((k) => k.kid === kid);
        if (!key) {
            throw new Error(`Key with ID \`${kid}\` not found`);
        }
        return key.key;
    }

    /**
     * Get the active key.
     */
    getActiveKey(): JwtCryptoKey {
        const key = this.keys.find((k) => k.kid === this.activeKid);
        if (!key) {
            throw new Error(`Active key not found`);
        }
        return key;
    }

    /**
     * Set the active key by its key ID (kid).
     *
     * @param key
     */
    setActiveKey(key: JwtCryptoKey): void {
        this.activeKid = key.kid;
    }

    /**
     * Check if the key manager is available.
     */
    isAvailable(): boolean {
        return this.keys.length > 0 && this.activeKid !== "";
    }

    /**
     * Get all keys in the key manager.
     */
    getKeys(): JwtCryptoKey[] {
        return this.keys;
    }

    /**
     * Remove a key by its key ID (kid).
     *
     * @param kid
     */
    removeKey(kid: string): void {
        this.keys = this.keys.filter((key) => key.kid !== kid);
    }

    /**
     * Load keys from environment variables.
     *
     * The following environment variables are required:
     * - `KV_ENCRYPTION_KEY`
     *
     * @param active - Whether the key should be set as active
     */
    async fromEnv(active: boolean = true): Promise<this> {
        const env = getEnv(false);
        if (!env.KV_ENCRYPTION_KEY) {
            throw new Error(
                "The `KV_ENCRYPTION_KEY` environment variable is required",
            );
        }

        await this.addKey(env.KV_ENCRYPTION_KEY, active);

        return this;
    }

    /**
     * Adds keys where encryption should not be applied
     *
     * @param exceptKeys
     */
    addExceptKvKeys(exceptKeys: KvKey[]) {
        this.exceptKvKeys.push(...exceptKeys);
    }

    /**
     * Adds keys where encryption should only be applied
     *
     * @param onlyKeys
     */
    addOnlyKvKeys(onlyKeys: KvKey[]) {
        this.onlyKvKeys.push(...onlyKeys);
    }

    /**
     * Check if a key should be encrypted.
     *
     * @param key
     */
    shouldEncrypt(key: string[]): boolean {
        // If no key manager is available, do not encrypt
        if (!this.isAvailable()) {
            return false;
        }

        // Check the onlyKvKeys first
        if (this.onlyKvKeys.length > 0) {
            const isInOnlyKeys = this.onlyKvKeys.some((keyPath) =>
                this.matchKeyPath(keyPath, key)
            );
            if (!isInOnlyKeys) {
                return false; // If not in onlyKvKeys, do not encrypt
            }
        }

        // Check the exceptKvKeys next
        return !this.exceptKvKeys.some((keyPath) =>
            this.matchKeyPath(keyPath, key)
        );
    }

    /**
     * Utility function to match key paths, supporting wildcards
     *
     * @param pattern - The pattern to match
     * @param key - The key to match
     */
    private matchKeyPath(pattern: KvKey, key: KvKey): boolean {
        if (pattern.length !== key.length) return false;

        return pattern.every((part, index) =>
            part === "*" || part === key[index]
        );
    }
}

/**
 * The key of an entry in the key-value store.
 */
export type KvKey = string[];

/**
 * Represents a JSON value.
 */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonArray
    | JsonObject;

/**
 * Represents a JSON object.
 */
export interface JsonObject {
    [key: string]: JsonValue;
}

/**
 * Represents a JSON array.
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * The value of an entry in the key-value store.
 */
export type KvValue = JsonValue | EncryptedKvValue;

/**
 * The encrypted value of an entry in the key-value store.
 */
export type EncryptedKvValue = {
    ct: string;
    iv: Uint8Array;
    kid: string;
};

/**
 * JSON Web Key (JWK) representation.
 */
export interface Jwk {
    kty: "oct";
    k: string;
    kid: string;
}

/**
 * JSON Web Token (JWT) representation with CryptoKey.
 */
export interface JwtCryptoKey extends Jwk {
    key: CryptoKey;
}

/**
 * Key-value list selector.
 */
export interface KvListSelector {
    prefix?: KvKey;
    limit?: number;
    offset?: number;
    reverse?: boolean;
}

/**
 * The operation to perform in the key-value store.
 */
export type KvOperation = KvSetOperation | KvDeleteOperation;

/**
 * Set operation to update an entry in the key-value store.
 */
export interface KvSetOperation {
    type: "set";
    key: KvKey;
    value: KvValue;
    encrypted: boolean;
}

/**
 * Delete operation to remove an entry from the key-value store.
 */
export interface KvDeleteOperation {
    type: "delete";
    key: KvKey;
}

/**
 * Key-value list iterator.
 */
export interface KvListIterator<T = unknown> extends AsyncIterable<Entry<T>> {
    [Symbol.asyncIterator](): AsyncIterator<Entry<T>>;
}

/**
 * Represents an entry in the key-value store.
 */
export interface Entry<T = unknown> {
    key: KvKey;
    value: T;
    version: number | null;
    encrypted: boolean;
}

/**
 * The atomic check to perform in the key-value store.
 */
export interface AtomicCheck {
    key: KvKey;
    version: number | null;
}

/**
 * The result of an atomic commit in the key-value store.
 */
export interface KvCommitResult {
    ok: boolean;
    version: number | null;
}

/**
 * Key-value client options.
 */
export interface KvOptions {
    bucket?: string;
    accessToken?: string;
    endpoint?: string;
    region?: string;
    headers?: Record<string, string>;
    keyManager?: KeyManager;
    ignoreEnv?: boolean;
}
