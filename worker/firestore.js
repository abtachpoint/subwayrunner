import { getGoogleAccessToken } from './security.js';

export class StoreError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
  }
}

const clone = value => structuredClone(value);
const RETRIES = 6;
const REQUEST_TIMEOUT_MS = 15000;

export function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new StoreError('invalid_number', 400);
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  throw new StoreError('invalid_value', 400);
}

export function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeValue(item)]));
}

export function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number)) throw new StoreError('invalid_stored_number');
    return number;
  }
  if ('doubleValue' in value) {
    const number = Number(value.doubleValue);
    if (!Number.isFinite(number)) throw new StoreError('invalid_stored_number');
    return number;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  if ('timestampValue' in value) return value.timestampValue;
  throw new StoreError('unsupported_stored_value');
}

export function decodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]));
}

/** Firestore REST adapter. Only server-scoped OAuth can access this database. */
export class Firestore {
  constructor(env, fetcher = fetch) {
    this.env = env;
    this.fetcher = fetcher;
    this.prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    this.root = `https://firestore.googleapis.com/v1/${this.prefix}`;
  }

  async request(suffix, method = 'GET', body, allow404 = false) {
    const token = await getGoogleAccessToken(this.env, ['https://www.googleapis.com/auth/datastore'], this.fetcher);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(this.root + suffix, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (allow404 && response.status === 404) return null;
      if (!response.ok) {
        let code;
        try { code = (await response.json()).error?.status; } catch { /* Never reflect Google's response body. */ }
        throw new StoreError(code === 'ABORTED' ? 'transaction_conflict' : 'firestore_unavailable', code === 'ABORTED' ? 409 : 503);
      }
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (error instanceof StoreError) throw error;
      // Network, timeout and malformed-response failures expose no URL, token,
      // Google body or underlying exception details to an API client.
      throw new StoreError('firestore_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  path(path) {
    if (typeof path !== 'string' || !/^[A-Za-z0-9_\-/]+$/.test(path) || path.includes('..') || path.split('/').some(part => !part)) throw new StoreError('invalid_document_path', 400);
    return '/' + path.split('/').map(encodeURIComponent).join('/');
  }

  async get(path) {
    const document = await this.request(this.path(path), 'GET', undefined, true);
    return document ? decodeFields(document.fields || {}) : null;
  }

  async transaction(action) {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      let transaction;
      try {
        const begun = await this.request(':beginTransaction', 'POST', { options: { readWrite: {} } });
        transaction = begun.transaction;
        if (typeof transaction !== 'string' || !transaction) throw new StoreError('firestore_unavailable');
        const writes = new Map();
        const reads = new Map();
        const tx = {
          get: async path => {
            if (writes.has(path)) return clone(writes.get(path));
            if (!reads.has(path)) {
              const document = await this.request(this.path(path) + '?transaction=' + encodeURIComponent(transaction), 'GET', undefined, true);
              reads.set(path, document ? decodeFields(document.fields || {}) : null);
            }
            return clone(reads.get(path));
          },
          set: (path, value) => { this.path(path); writes.set(path, clone(value)); },
          delete: path => { this.path(path); writes.set(path, null); }
        };
        const result = await action(tx);
        if (writes.size) {
          await this.request(':commit', 'POST', {
            transaction,
            writes: [...writes].map(([path, value]) => value === null
              ? { delete: `${this.prefix}/${path}` }
              : { update: { name: `${this.prefix}/${path}`, fields: encodeFields(value) } })
          });
        } else {
          await this.request(':rollback', 'POST', { transaction });
        }
        return result;
      } catch (error) {
        if (transaction) {
          try { await this.request(':rollback', 'POST', { transaction }); } catch { /* Preserve the action or commit error. */ }
        }
        if (error.code === 'transaction_conflict' && attempt < RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new StoreError('transaction_retries_exhausted');
  }

  async query(collection, field, value, limit = 100) {
    const data = await this.request(':runQuery', 'POST', {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encodeValue(value) } },
        limit
      }
    });
    return data.filter(item => item.document).map(item => ({
      path: item.document.name.slice(this.prefix.length + 1),
      value: decodeFields(item.document.fields || {})
    }));
  }

  async deleteTree(path) {
    this.path(path);
    // Collect every collection ID before deletion changes the parent's list.
    // Deleting a document alone never deletes its Firestore subcollections.
    const collections = new Set();
    let collectionPage = '';
    do {
      const data = await this.request(this.path(path) + ':listCollectionIds', 'POST', {
        pageSize: 100,
        ...(collectionPage ? { pageToken: collectionPage } : {})
      });
      for (const collection of data.collectionIds || []) collections.add(collection);
      collectionPage = data.nextPageToken || '';
    } while (collectionPage);

    for (const collection of collections) {
      let documentPage = '';
      do {
        const data = await this.request(this.path(path + '/' + collection) + '?pageSize=100' + (documentPage ? '&pageToken=' + encodeURIComponent(documentPage) : ''));
        for (const document of data.documents || []) await this.deleteTree(document.name.slice(this.prefix.length + 1));
        documentPage = data.nextPageToken || '';
      } while (documentPage);
    }
    await this.request(this.path(path), 'DELETE', undefined, true);
  }
}
