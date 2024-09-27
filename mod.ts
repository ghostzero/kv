import axios, { type AxiosResponse } from "npm:axios@1.7.7";
import { defu } from "npm:defu@6.1.4";

/**
 * Create an atomic operation. Atomic operations allow you to perform multiple
 * operations in a single transaction.
 */
export class AtomicOperation {
    private checks: AtomicCheck[] = [];
    private operations: KvOperation[] = [];

    constructor(private url: string) {
        // Empty
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
        this.operations.push({ type: "set", key, value });
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

    async commit(): Promise<KvCommitResult> {
        const response = await axios.post(`${this.url}/atomic`, {
            checks: this.checks,
            operations: this.operations,
        }, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        });
        return response.data;
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
export function connect(options: KvOptions): Kv {
    const _options = defu(options, {
        accessToken: null,
        endpoint: null,
        bucket: null,
        region: "eu-central-1",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${options.accessToken}`,
        },
    });
    if (!_options.accessToken) {
        throw new Error("Access token is required");
    }
    const url: string = !_options.endpoint
        ? `https://kv.${_options.region}.kv-db.dev/v1/${_options.bucket}`
        : `${_options.endpoint}/v1/${_options.bucket}`;
    return {
        async get<T = KvValue>(key: KvKey): Promise<Entry<T>> {
            const response: AxiosResponse<Entry<T>> = await axios.get(
                `${url}/${key.join("/")}`,
                {
                    headers: _options.headers,
                },
            );
            return response.data;
        },
        getMany<T = KvValue>(
            keys: KvKey[],
        ): Promise<Entry<T>[]> {
            return Promise.all(
                keys.map((key: KvKey) => this.get(key) as Promise<Entry<T>>),
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
                        yield entry;
                    }
                },
            } as KvListIterator<T>;
        },
        async set<T = KvValue>(key: KvKey, value: T): Promise<Entry<T>> {
            const response = await axios.put(`${url}/${key.join("/")}`, {
                value,
            }, {
                headers: _options.headers,
            });
            return response.data;
        },
        atomic(): AtomicOperation {
            return new AtomicOperation(url);
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
 * The value of an entry in the key-value store.
 */
export type KvValue =
    | string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | unknown[];

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
    bucket: string;
    accessToken: string;
    endpoint?: string;
    region?: string;
    headers?: Record<string, string>;
}
