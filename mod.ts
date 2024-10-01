import axios, { type AxiosResponse } from "npm:axios@1.7.7";
import { defu } from "npm:defu@6.1.4";

/**
 * Create an atomic operation. Atomic operations allow you to perform multiple
 * operations in a single transaction.
 */
export class AtomicOperation {
    private checks: AtomicCheck[] = [];
    private operations: KvOperation[] = [];
    private readonly encryptionKey?: CryptoKey;

    constructor(private url: string, encryptionKey?: CryptoKey) {
        this.encryptionKey = encryptionKey;
    }

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
    set(key: KvKey, value: KvValue): this {
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
                        this.encryptionKey
                    ) {
                        const encryptedValue = await encryptData(
                            this.encryptionKey,
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
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
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
        encryptionKey: env.KV_ENCRYPTION_KEY
            ? await importCryptoKey(env.KV_ENCRYPTION_KEY)
            : undefined,
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
    return {
        async get<T = KvValue>(key: KvKey): Promise<Entry<T>> {
            const { data } = await axios.get(`${url}/${key.join("/")}`, {
                headers: _options.headers,
            }) as AxiosResponse<Entry<T>>;

            let value: T = data.value;

            if (data.encrypted) {
                if (!_options.encryptionKey) {
                    throw new Error(
                        "Encrypted value received but no encryption key provided",
                    );
                }
                if (typeof data.value !== "object") {
                    throw new Error(
                        "Encrypted value received but value is not a object",
                    );
                }

                value = await decryptData<T>(
                    _options.encryptionKey,
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
                            if (!_options.encryptionKey) {
                                throw new Error(
                                    "Encrypted value received but no encryption key provided",
                                );
                            }
                            if (typeof entry.value !== "object") {
                                throw new Error(
                                    "Encrypted value received but value is not a object",
                                );
                            }
                            decryptedValue = await decryptData<T>(
                                _options.encryptionKey,
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
            if (_options.encryptionKey) {
                encryptedValue = await encryptData(
                    _options.encryptionKey,
                    value as KvValue,
                );
            }

            const { data } = await axios.put(`${url}/${key.join("/")}`, {
                value: encryptedValue,
                encrypted: !!_options.encryptionKey,
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
            return new AtomicOperation(url, _options.encryptionKey);
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
 * @param key - The key to use for encryption
 * @param data - The data to encrypt
 */
async function encryptData(key: CryptoKey, data: KvValue): Promise<KvValue> {
    const iv = generateIV();
    const encodedData = new TextEncoder().encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encodedData,
    );

    const ct = btoa(String.fromCharCode(...new Uint8Array(encrypted)));

    return { ct, iv };
}

/**
 * Decrypt data using the provided key.
 *
 * @param key - The key to use for decryption
 * @param data - The data to decrypt (contains ct and IV)
 * @returns The decrypted KvValue object
 */
async function decryptData<T = KvValue>(
    key: CryptoKey,
    data: EncryptedKvValue,
): Promise<T> {
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
        console.error("Decryption failed:", error);
        throw new Error("Decryption failed"); // Handle decryption failure
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
 * Export a CryptoKey to a base64 string.
 *
 * @param key - The key to export
 */
export async function exportCryptoKey(key: CryptoKey): Promise<string> {
    const rawKey = await crypto.subtle.exportKey("raw", key);
    const keyBuffer = new Uint8Array(rawKey);
    return btoa(String.fromCharCode(...keyBuffer));
}

/**
 * Import a CryptoKey from a base64 string.
 *
 * @param base64Key - The base64 string to import
 */
export async function importCryptoKey(base64Key: string): Promise<CryptoKey> {
    const rawKey = new Uint8Array(
        Array.from(atob(base64Key), (c) => c.charCodeAt(0)),
    );
    return await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM" },
        true, // Extractable key
        ["encrypt", "decrypt"], // Usage for encryption and decryption
    );
}

/**
 * @module
 *
 * This module provides a simple key-value store client for Deno and other JavaScript/TypeScript runtimes.
 */
export interface Kv {
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
};

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
    encryptionKey?: CryptoKey;
    ignoreEnv?: boolean;
}
