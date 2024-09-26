import axios, { type AxiosResponse } from "npm:axios@1.6.2";
import { defu } from "npm:defu@6.1.4";

/**
 * Represents an Atomic operation.
 */
export class AtomicOperation {
    private checks: AtomicCheck[] = [];
    private operations: KvOperation[] = [];

    constructor(private url: string) {
        // Empty
    }

    check(...checks: AtomicCheck[]): this {
        this.checks.push(...checks);
        return this;
    }

    set(key: KvKey, value: KvValue): this {
        this.operations.push({ type: "set", key, value });
        return this;
    }

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
 * @param accessToken - The access token
 * @param options - The options
 */
export function simpleKv(accessToken: string, options: KvOptions = {}): Kv {
    const _options = defu(options, {
        url: "http://localhost:5832/api/",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    });
    const url = `${_options.url}${accessToken}`;
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

export interface Kv {
    get<T = KvValue>(key: KvKey): Promise<Entry<T>>;
    getMany<T = KvValue>(keys: KvKey[]): Promise<Entry<T>[]>;
    list<T = KvValue>(selector: KvListSelector): Promise<KvListIterator<T>>;
    set<T = KvValue>(key: KvKey, value: T): Promise<Entry<T>>;
    atomic(): AtomicOperation;
    delete(key: KvKey): Promise<boolean>;
}

export type KvKey = string[];

export type KvValue =
    | string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | unknown[];

export interface KvListSelector {
    prefix?: KvKey;
    limit?: number;
    offset?: number;
    reverse?: boolean;
}

export type KvOperation = KvSetOperation | KvDeleteOperation;

export interface KvSetOperation {
    type: "set";
    key: KvKey;
    value: KvValue;
}

export interface KvDeleteOperation {
    type: "delete";
    key: KvKey;
}

export interface KvListIterator<T = unknown> extends AsyncIterable<Entry<T>> {
    [Symbol.asyncIterator](): AsyncIterator<Entry<T>>;
}

export interface Entry<T = unknown> {
    key: KvKey;
    value: T;
    version: string | null;
}

export interface AtomicCheck {
    key: KvKey;
    version: string | null;
}

export interface KvCommitResult {
    ok: boolean;
}

export interface KvOptions {
    url?: string;
    headers?: Record<string, string>;
}
