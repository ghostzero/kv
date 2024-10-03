import { assert, assertEquals, AssertionError } from "@std/assert";
import {
    connect,
    exportCryptoKey,
    generateCryptoKey,
    importCryptoKey,
    KeyManager,
    KvOptions,
} from "./mod.ts";

interface User {
    id: string;
    name: string;
}

interface Preferences extends Record<string, any> {
    username: string;
    theme: string;
    language: string;
}

const options: KvOptions = {
    endpoint: "http://localhost:8000",
    bucket: "9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745",
    accessToken: "9d264a49-ca25-461a-9543-616af8ba7fea",
};

Deno.test(async function testManualKvConfiguration() {
    await assertThrowsAsync(async () => {
        await connect({ ...options, accessToken: undefined });
    }, "The `accessToken` option is required");

    const kv = await connect({ ...options, endpoint: undefined });
    assertEquals(
        kv.options.endpoint,
        "https://kv.eu-central-1.kv-db.dev/v1/9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745",
    );

    await connect(options);
});

Deno.test(async function testAutomaticKvConfiguration() {
    Deno.env.set("KV_ENDPOINT", options.endpoint as string);
    Deno.env.set("KV_BUCKET", options.bucket as string);
    Deno.env.set("KV_ACCESS_TOKEN", options.accessToken as string);

    const kv = await connect();

    Deno.env.delete("KV_ENDPOINT");
    Deno.env.delete("KV_BUCKET");
    Deno.env.delete("KV_ACCESS_TOKEN");

    assertEquals(
        kv.options.endpoint,
        "http://localhost:8000/v1/9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745",
    );
    assertEquals(kv.options.bucket, "9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745");
    assertEquals(
        kv.options.accessToken,
        "9d264a49-ca25-461a-9543-616af8ba7fea",
    );
});

Deno.test(async function testKv() {
    const kv = await connect(options);

    await kv.set<User>(["users", "gz3"], {
        id: "gz3",
        name: "foo",
    });

    const entries = await kv.list({ prefix: ["account"] });

    for await (const entry of entries) {
        console.log(entry.key); // ["preferences", "ada"]
        console.log(entry.value); // { ... }
        console.log(entry.version); // "00000000000000010000"
    }
});

Deno.test(async function testAtomicDocumentOperations() {
    const kv = await connect(options);

    const key = ["preferences", "alan_turing"];
    await kv.delete(key);

    const res1 = await kv.atomic()
        .check({ key, version: null }) // `null` versions mean 'no value'
        .set(key, { "a": 1 })
        .commit();

    console.log(res1);
    assertEquals(res1.ok, true); // Preferences did not yet exist. Inserted!

    const res2 = await kv.atomic()
        .check({ key, version: null }) // `null` versions mean 'no value'
        .set(key, { "a": 2 })
        .commit();

    console.log(res2);
    assertEquals(res2.ok, false); // Preferences already exist!

    const res4 = await kv.atomic()
        .check({ key, version: res1.version })
        .delete(key)
        .commit();

    console.log(res4);
    assertEquals(res4.ok, true); // Preferences deleted!

    const res5 = await kv.atomic()
        .check({ key, version: res1.version })
        .delete(key)
        .commit();

    console.log(res5);
    assertEquals(res5.ok, false); // Preferences already deleted!

    const res6 = await kv.atomic()
        .check({ key, version: null })
        .delete(key)
        .commit();

    console.log(res6);
    assertEquals(res6.ok, true); // Preferences deleted!
});

Deno.test(async function testAtomicBankAccountOperations() {
    const kv = await connect(options);

    await kv.set(["account", "alice"], { balance: 1000 });
    await kv.set(["account", "bob"], { balance: 0 });

    await transferFunds("alice", "bob", 100);

    console.log("Transfer complete");

    interface Account {
        balance: number;
    }

    async function transferFunds(
        sender: string,
        receiver: string,
        amount: number,
    ) {
        if (amount <= 0) throw new Error("Amount must be positive");

        // Construct the KV keys for the sender and receiver accounts.
        const senderKey = ["account", sender];
        const receiverKey = ["account", receiver];

        // Retry the transaction until it succeeds.
        let res = { ok: false };
        while (!res.ok) {
            // Read the current balance of both accounts.
            const [senderRes, receiverRes] = await kv.getMany<Account>([
                senderKey,
                receiverKey,
            ]);
            if (senderRes.value === null) {
                throw new Error(`Account ${sender} not found`);
            }
            if (receiverRes.value === null) {
                throw new Error(`Account ${receiver} not found`);
            }

            const senderBalance = senderRes.value;
            const receiverBalance = receiverRes.value;

            // Ensure the sender has a sufficient balance to complete the transfer.
            if (senderBalance.balance < amount) {
                throw new Error(
                    `Insufficient funds to transfer ${amount} from ${sender}`,
                );
            }

            // Perform the transfer.
            const newSenderBalance = senderBalance.balance - amount;
            const newReceiverBalance = receiverBalance.balance + amount;

            // Attempt to commit the transaction. `res` returns an object with
            // `ok: false` if the transaction fails to commit due to a check failure
            // (i.e. the version for a key has changed)
            res = await kv.atomic()
                .check(senderRes) // Ensure the sender's balance hasn't changed.
                .check(receiverRes) // Ensure the receiver's balance hasn't changed.
                .set(senderKey, { balance: newSenderBalance }) // Update the sender's balance.
                .set(receiverKey, { balance: newReceiverBalance }) // Update the receiver's balance.
                .commit(); // Commit the transaction.

            console.log(res);
        }
    }
});

Deno.test(async function testCryptoKeys() {
    const cryptoKey = await generateCryptoKey();
    const exported = await exportCryptoKey(cryptoKey);
    assert(exported);
    const imported = await importCryptoKey(exported);
    assert(imported.kid);
});

Deno.test(async function testCryptoKeysWithKid() {
    const cryptoKey = await generateCryptoKey();
    const exported = await exportCryptoKey(cryptoKey, "foo");
    assert(exported);
    const imported = await importCryptoKey(exported);
    assert(imported);
    assertEquals(imported.kid, "foo");
});

Deno.test(async function testKeyManager() {
    // Testing KeyManager
    const keyManager = new KeyManager();

    await assertThrowsAsync(async () => {
        await keyManager.fromEnv();
    }, "The `KV_ENCRYPTION_KEY` environment variable is required");

    Deno.env.set(
        "KV_ENCRYPTION_KEY",
        "eyJrdHkiOiJvY3QiLCJrIjoidCtUczZCS3dKL2xXeExmRHhDZk9YUERWb0krMzdWcWQ5elA0c01Ma0dVZz0iLCJraWQiOiJiZHdkamkifQ==",
    );

    await keyManager.fromEnv(); // Assuming this loads a key from environment

    assertEquals(keyManager.isAvailable(), true);
    assertEquals(keyManager.getKeys().length, 1);

    const kv = await connect({ ...options, keyManager });

    const key = ["users", "encrypted"];

    const encryptedEntry = await kv.set<User>(key, {
        id: "encrypted",
        name: "Encrypted",
    });
    assertEquals(encryptedEntry.value.name, "Encrypted");

    const res = await kv.atomic()
        .check({ key, version: encryptedEntry.version })
        .set(key, { id: "encrypted", name: "Encrypted2" })
        .commit();

    assertEquals(res.ok, true);

    const entry3 = await kv.get<User>(key);
    assertEquals(entry3.value.name, "Encrypted2");

    await kv.delete(key);

    keyManager.removeKey("bdwdji");
    assertEquals(keyManager.getKeys().length, 0);
});

Deno.test(async function testInvalidKid() {
    // Testing KeyManager
    const keyManager = new KeyManager();
    await assertThrowsAsync(async () => {
        await keyManager.addKey(
            await exportCryptoKey(await generateCryptoKey(), ""),
            true,
        );
    }, "The `kid` property is required");
    await connect({ ...options, keyManager });
});

Deno.test(async function testDisabledKeyManager() {
    const keyManager = new KeyManager();
    assert(!keyManager.isAvailable());

    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        false,
    );
    assert(!keyManager.isAvailable());

    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );
    assert(keyManager.isAvailable());
});

Deno.test(async function testInvalidDecryptionKey() {
    const keyManagerOff = new KeyManager();
    await keyManagerOff.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        false,
    );
    assert(!keyManagerOff.isAvailable());

    // Testing KeyManager
    const keyManager = new KeyManager();
    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );
    const kv = await connect({ ...options, keyManager });

    const key = ["users", "encrypted"];

    const encryptedEntry = await kv.set<User>(key, {
        id: "encrypted",
        name: "Encrypted",
    });
    assertEquals(encryptedEntry.value.name, "Encrypted");

    // decrypt with right key manager
    const entry = await kv.get<User>(key);
    assertEquals(entry.value.name, "Encrypted");

    const kv2 = await connect({ ...options });

    // decrypt with no key manager
    await assertThrowsAsync(async () => {
        await kv2.get<User>(key);
    }, "Encrypted value received but no key manager available");

    // decrypt with wrong key
    const keyManager2 = new KeyManager();
    await keyManager2.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );
    const kv3 = await connect({ ...options, keyManager: keyManager2 });

    await assertThrowsAsync(async () => {
        await kv3.get<User>(key);
    }, "Failed to decrypt value");

    // decrypt with wrong key
    const keyManager3 = new KeyManager();
    await keyManager3.addKey(
        await exportCryptoKey(await generateCryptoKey(), "bar"),
        true,
    );
    const kv4 = await connect({ ...options, keyManager: keyManager3 });

    await assertThrowsAsync(async () => {
        await kv4.get<User>(key);
    }, "Key with ID `foo` not found");
});

async function assertThrowsAsync(fn: () => Promise<void>, msg: string) {
    let didThrow = false;
    try {
        await fn();
    } catch (e) {
        didThrow = true;
        assertEquals(e.message, msg);
    }
    if (!didThrow) {
        throw new AssertionError("Function did not throw");
    }
}

Deno.test(async function testSpecificKeys() {
    const keyManager = new KeyManager();
    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );

    keyManager.addOnlyKvKeys([
        ["foo", "*"],
    ]);

    keyManager.addExceptKvKeys([
        ["foo", "bar"],
        ["bar", "baz"],
    ]);

    // Case 1: ["foo", "test"] should return true (because it's in onlyKeys)
    let result = keyManager.shouldEncrypt(["foo", "test"]);
    assertEquals(result, true, `Expected true but got ${result} for ["foo", "test"]`);

    // Case 2: ["foo", "bar"] should return false (because it's in exceptKeys)
    result = keyManager.shouldEncrypt(["foo", "bar"]);
    assertEquals(result, false, `Expected false but got ${result} for ["foo", "bar"]`);

    // Case 3: ["bar", "baz"] should return false (because it's in exceptKeys)
    result = keyManager.shouldEncrypt(["bar", "baz"]);
    assertEquals(result, false, `Expected false but got ${result} for ["bar", "baz"]`);

    // Case 4: ["bar", "qux"] should return false (because it's not in onlyKeys)
    result = keyManager.shouldEncrypt(["bar", "qux"]);
    assertEquals(result, false, `Expected false but got ${result} for ["bar", "qux"]`);

    // Case 5: ["foo", "qux"] should return true (because it's in onlyKeys with wildcard)
    result = keyManager.shouldEncrypt(["foo", "qux"]);
    assertEquals(result, true, `Expected true but got ${result} for ["foo", "qux"]`);

    // Case 6: ["baz", "qux"] should return false (because it's neither in exceptKeys nor excluded by onlyKeys)
    result = keyManager.shouldEncrypt(["baz", "qux"]);
    assertEquals(result, false, `Expected true but got ${result} for ["baz", "qux"]`);
});

// Test only addExceptKeys functionality
Deno.test(async function testOnlyExceptKeys() {
    const keyManager = new KeyManager();
    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );
    keyManager.addExceptKvKeys([
        ["foo", "bar"],
        ["baz", "qux"],
    ]);

    // No onlyKeys defined, should not encrypt if in exceptKeys
    let result;

    // Case 1: ["foo", "bar"] should return false (because it's in exceptKeys)
    result = keyManager.shouldEncrypt(["foo", "bar"]);
    assertEquals(result, false, `Expected false but got ${result} for ["foo", "bar"]`);

    // Case 2: ["baz", "qux"] should return false (because it's in exceptKeys)
    result = keyManager.shouldEncrypt(["baz", "qux"]);
    assertEquals(result, false, `Expected false but got ${result} for ["baz", "qux"]`);

    // Case 2: ["baz", "qux", "foo"] should return false (because it's in exceptKeys)
    result = keyManager.shouldEncrypt(["baz", "qux", "foo"]);
    assertEquals(result, true, `Expected false but got ${result} for ["baz", "qux", "foo"]`);

    // Case 3: ["qux", "foo"] should return true (not in exceptKeys and no onlyKeys)
    result = keyManager.shouldEncrypt(["qux", "foo"]);
    assertEquals(result, true, `Expected true but got ${result} for ["qux", "foo"]`);
});

// Test only addOnlyKeys functionality
Deno.test(async function testOnlyOnlyKeys() {
    const keyManager = new KeyManager();
    await keyManager.addKey(
        await exportCryptoKey(await generateCryptoKey(), "foo"),
        true,
    );
    keyManager.addOnlyKvKeys([
        ["foo", "*"],
        ["bar", "baz"],
    ]);

    // No exceptKeys defined, should encrypt if in onlyKeys
    let result;

    // Case 1: ["foo", "test"] should return true (because it's in onlyKeys)
    result = keyManager.shouldEncrypt(["foo", "test"]);
    assertEquals(result, true, `Expected true but got ${result} for ["foo", "test"]`);

    // Case 2: ["bar", "baz"] should return true (because it's in onlyKeys)
    result = keyManager.shouldEncrypt(["bar", "baz"]);
    assertEquals(result, true, `Expected true but got ${result} for ["bar", "baz"]`);

    // Case 3: ["baz", "qux"] should return false (not in onlyKeys)
    result = keyManager.shouldEncrypt(["baz", "qux"]);
    assertEquals(result, false, `Expected false but got ${result} for ["baz", "qux"]`);
});