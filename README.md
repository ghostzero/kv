# Key-Value Client

## Installation

To install the key-value store client, run the following command:

```bash
# deno
deno add jsr:@gz/kv

# npm (use any of npx, yarn dlx, pnpm dlx, or bunx)
npx jsr add @gz/kv
```

## Opening the Key-Value Store

To open the key-value store, run the following command:

```ts
import { connect } from "@gz/kv";

const kv = await connect({
    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
    accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
    region: 'eu-central-1'
});
```

### Environment Variables

You can also use environment variables to configure the key-value store. The key-value store client will automatically
use the environment variables if they are set.

- `KV_ACCESS_TOKEN` - The access token for the key-value store.
- `KV_ENDPOINT` - The endpoint for the key-value store.
- `KV_BUCKET` - The bucket for the key-value store.
- `KV_REGION` - The region for the key-value store.
- `KV_ENCRYPTION_KEY` - The encryption key for the key-value store.

If you want to ignore your environment variables, you can pass the `ignoreEnv` option to the `connect()` function. This
will prevent the key-value store client from using these environment variables.

## Creating a User interface

Since we're going to use TypeScript, we can create an interface for our User object. So it's easier to work with.
Here we define a User interface with a name and an email for example.

```typescript
interface User {
    id: string;
    name: string;
    email: string;
}
```

## Creating, updating, and reading a key-value pair

Now, we can create our first key-value pair. We use the `set()` method to create a new key-value pair. The key is an
array of strings and the value is the value you want to store. Internally, the key-array is joined with a separator to
create a unique key.

```typescript
const key = ['users', '1'];
const value: User = {id: '1', name: 'GhostZero', email: 'example@example.com'};
await kv.set(key, value);
```

Once the key-value pair is created, you can read it back using the `get()` method. The `get()` method returns an object
with the `key`, `value`, and `version`.

```typescript
const key = ['users', '1'];
const entry = await kv.get<User>(key);

console.log(entry.key);
console.log(entry.value);
console.log(entry.version);
```

## Deleting a key-value pair

You can delete a key-value pair using the `delete()` method. The `delete()` method returns a boolean indicating if the
key-value pair was deleted.

```typescript
const key = ['users', '1'];
await kv.delete(key);
```

## Atomic transactions

The Key-Value Store supports atomic transactions. This means that you can perform multiple operations in a single
transaction. If any of the operations fail, the entire transaction is rolled back.

```typescript
const key = ['users', '1'];
const value: User = {id: '1', name: 'GhostZero', email: 'example@example.com'};

const res = await kv.atomic()
    .check({key, version: null /* or a version */})
    .set(key, value)
    .commit();

if (res.ok) {
    console.log('Entry did not exist and was created');
} else {
    console.log('Entry already exist. No changes were made');
}
```

## Improve querying with secondary indexes

With the Key-Value Store, you can only query by the key. If you want to query by a different field, you can create a
secondary index. A secondary index is a key-value pair where the key is the field you want to query by and the value is
the primary key.

```typescript
async function saveUser(user: User) {
    const key = ['users', user.id]

    // set the primary key
    const r = await kv.set(key, user)

    // set the secondary key's value to be the primary key
    await kv.set(['users_by_email', user.email], key)

    return r
}

async function getById(id) {
    // use as usual
    return await kv.get<User>(['users', id])
}

async function getByEmail(email) {
    // lookup the primary key by the secondary key
    const r1 = await kv.get<array[]>(['users_by_email', email])
    const r2 = await kv.get<User>(r1.value)
    return r2
}
```

## Client-side Encryption

The Key-Value Store supports client-side encryption. This means that the data is encrypted before it is sent to the
server. The server only sees the encrypted data and cannot decrypt it. The encryption key is stored on the client-side
and is never sent to the server.

### Generating a key

To generate a new encryption key, you can use the `generateCryptoKey()` function. The `generateCryptoKey()` function
returns a new encryption key. You can then export the key using the `exportCryptoKey()` function.

The exported key is a Base64-encoded string that you can store in a secure location and import later.

> [!CAUTION]
> Make sure to store the encryption key in a secure location. If you lose the encryption key, you will not be able to
> decrypt the encrypted data. The Key-Value Store does not store the encryption key!

```typescript
import { generateCryptoKey, exportCryptoKey } from "@gz/kv";

// generate a new encryption key
const cryptoKey = await generateCryptoKey();
const exportedKey = await exportCryptoKey(cryptoKey);

// you can store the exported key in a secure location
console.log(exportedKey);
```

### Using the key

To use the encryption key, you need to use the `KeyManager` class. The `KeyManager` class manages the encryption keys
and allows you to import multiple keys (which can be useful for key rotation).

> [!IMPORTANT]
> Client-side encryption can be enabled anytime by passing the `KeyManager` to the `connect()` function. If you
> disable client-side encryption, new data will not be encrypted, but existing data will remain encrypted.

> [!IMPORTANT]
> The KeyManager utilizes only active keys for encryption. You can add multiple keys to the KeyManager, but only one key
> can be designated as active at a time. The active key is defined as the most recently added key with the active flag
> set to true. If there is no active key, the KeyManager will refrain from encrypting data and will use the keys solely
> for decryption.

```typescript
import { connect, KeyManager } from "@gz/kv";

// example 1: import the key from environment variables
const keyManager = await new KeyManager().fromEnv();

// example 2: import the key from a Base64-encoded string
const keyManager = new KeyManager();
await keyManager.addKey(exportedKey, true);

// connect to the key-value store with the encryption key
const kv = await connect({
    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
    accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
    region: 'eu-central-1',
    keyManager
});
```

### Manage what data is encrypted

By default, all data is encrypted. If you want to disable encryption for a specific key-value pair, you can use the
`addOnlyKvKeys([...])` or `addExceptKvKeys([...])` methods on the `KeyManager` class.

> [!IMPORTANT]
> When using `*` as a key, it acts as a wildcard and matches all keys after it. For example, `['users', '*']` will match
> all keys that start with `users`.

**Example: Encrypt only the `users` key**

```typescript
const keyManager = new KeyManager();

// only encrypt the 'users' key
keyManager.addOnlyKvKeys([['users', '*']]);
```

**Example: Encrypt all keys except the `users` key**

```typescript
const keyManager = new KeyManager();

// encrypt all keys except the 'users' key
keyManager.addExceptKvKeys([['users', '*']]);
```

## Frontend-Safe Access with JWT

Normally, `accessToken` is a bucket-wide secret — it must stay on the backend. If you're building a widget where
viewers only need to read/write **their own data** (a personal to-do list, per-viewer settings, ...), you don't have
to write backend code to proxy that. Connect with a user JWT instead of an `accessToken`, and the server enforces —
per request — that the JWT's owner can only touch key paths configured for their user ID.

> [!IMPORTANT]
> This requires server-side setup first: the kvdb bucket needs a JWT secret and a set of allowed key path patterns
> configured. See the [kvdb README](https://github.com/ghostzero/kvdb#frontend-jwt-access-baas) for the full
> server-side guide. Nothing below will work against a bucket that hasn't been configured for JWT access.

```ts
import { connect } from "@gz/kv";

const kv = await connect({
    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
    jwt: userJwt, // a JWT for the currently signed-in viewer, sub = their user id
});
```

`jwt` and `accessToken` are mutually exclusive credentials — if both are set, `jwt` wins. Passing `jwt` also routes
requests through the server's frontend-safe endpoint rather than the backend one, so an `accessToken`-shaped secret
accidentally left in the same options object is never sent.

**Example: a per-viewer to-do list**

Assuming the bucket has a rule allowing `['todos', '{user_id}', '*']` for `read`/`write` (see the kvdb README for how
to configure this), a widget can read and write only the current viewer's own todos:

```ts
const key = ['todos', currentUserId, 'task1'];

await kv.set(key, { text: 'Buy milk', done: false });

const entry = await kv.get(key);
console.log(entry.value); // { text: 'Buy milk', done: false }

await kv.delete(key);
```

Trying to read or write a key path the JWT isn't allowed to touch — another user's data, or a path with no matching
rule at all — fails with an HTTP 403. An invalid, expired, or wrong-signature JWT fails with a 401. Both are thrown as
errors by the underlying HTTP client:

```ts
try {
    await kv.get(['todos', someOtherUserId, 'task1']);
} catch (e) {
    // e.g. "Request failed with status code 403"
    console.error(e.message);
}
```

> [!IMPORTANT]
> `list()` and `atomic()` are not available over a JWT connection — they operate on a set of keys rather than a
> single key path, which the server can't yet authorize per-request. Use `get()`/`set()`/`delete()` on individual
> keys from the frontend, and keep any listing or batched/atomic operations on the backend with an `accessToken`.
