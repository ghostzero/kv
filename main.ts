import axios, { AxiosResponse } from 'npm:axios'

export class AtomicOperation {
    private checks: AtomicCheck[] = []
    private operations: any[] = []

    constructor(private url: string) {
    }

    check(...checks: AtomicCheck[]): this {
        this.checks.push(...checks)
        return this
    }

    set(key: KvKey, value: unknown): this {
        this.operations.push({type: 'set', key, value})
        return this
    }

    delete(key: KvKey): this {
        this.operations.push({type: 'delete', key})
        return this
    }

    async commit(): Promise<KvCommitResult> {
        const response = await axios.post(`${this.url}/atomic`, {
            checks: this.checks,
            operations: this.operations,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        })
        return response.data
    }
}

export function simpleKv(accessToken: string) {
    const url = `http://localhost:8123/api/${accessToken}`
    return {
        async get<T = unknown>(key: KvKey): Promise<Entry<T>> {
            const response: AxiosResponse<Entry<T>> = await axios.get(`${url}/${key.join('/')}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            })
            return response.data
        },
        getMany<T extends readonly unknown[]>(keys: KvKey[]): Promise<Entry<T>[]> {
            return Promise.all(keys.map((key: KvKey) => this.get(key) as Promise<Entry<T>>))
        },
        async list<T = unknown>(selector: KvListSelector): Promise<KvListIterator<T>> {
            const response: AxiosResponse<Entry<T>[]> = await axios.get(url, {
                params: selector,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            })
            return {
                [Symbol.asyncIterator]: async function* () {
                    for (const entry of response.data) {
                        yield entry
                    }
                },
            } as KvListIterator<T>
        },
        async set(key: KvKey, value: any) {
            const response = await axios.put(`${url}/${key.join('/')}`, {value}, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            })
            return response.data
        },
        atomic(): AtomicOperation {
            return new AtomicOperation(url)
        },
        async delete(key: KvKey) {
            return await fetch(`${url}/${key.join('/')}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            }).then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to delete value')
                }
                if (response.body)
                    response.body.cancel()
            }).then(() => true)
        },
    }
}

export type KvKey = string[]

export interface KvListSelector {
    prefix?: KvKey;
    limit?: number;
    offset?: number;
    reverse?: boolean;
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