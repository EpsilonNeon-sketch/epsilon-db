/**
 * Epsilon DB — Client Library
 * 
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="epsilondbs.js"></script>
 *
 *   const db = new EpsilonDB({ apiKey: 'epk_live_...' });
 *   await db.createCollection('users');
 *   await db.collection('users').add({ name: 'John' });
 *   const docs = await db.collection('users').get();
 */
class EpsilonDB {
    constructor(options = {}) {
        this.apiKey = options.apiKey;
        if (!this.apiKey) throw new Error('EpsilonDB: apiKey is required');
        this.url = options.url || 'https://gfsqzkyviivhvyqadpeg.supabase.co';
        this.anonKey = options.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmc3F6a3l2aWl2aHZ5cWFkcGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NDI0NDQsImV4cCI6MjA4NjAxODQ0NH0.MwC6dMZKFZMyklCJKqr4DPek8dxR-EswBZSd1L_AkMA';
        this._client = null;
        this._userId = null;
        this._ready = false;
    }

    async _init() {
        if (this._ready) return;
        const { createClient } = supabase;
        this._client = createClient(this.url, this.anonKey, {
            global: {
                headers: { 'x-epsilon-key': this.apiKey }
            }
        });
        // Validate key & find user
        const { data, error } = await this._client
            .from('profiles')
            .select('id, db')
            .contains('db', { api_keys: [{ key: this.apiKey }] })
            .single();
        if (error || !data) throw new Error('EpsilonDB: Invalid API key');
        this._userId = data.id;
        this._ready = true;
    }

    async _getProfile() {
        await this._init();
        const { data, error } = await this._client
            .from('profiles')
            .select('db')
            .eq('id', this._userId)
            .single();
        if (error) throw new Error('EpsilonDB: Failed to fetch profile — ' + error.message);
        if (!data.db) data.db = { collections: {}, api_keys: [] };
        if (!data.db.collections) data.db.collections = {};
        return data.db;
    }

    async _saveProfile(db) {
        const { error } = await this._client
            .from('profiles')
            .update({ db: db, updated_at: new Date().toISOString() })
            .eq('id', this._userId);
        if (error) throw new Error('EpsilonDB: Failed to save — ' + error.message);
    }

    /** List all collection names */
    async listCollections() {
        const db = await this._getProfile();
        return Object.keys(db.collections || {});
    }

    /** Create a new collection */
    async createCollection(name) {
        if (!name || typeof name !== 'string') throw new Error('EpsilonDB: Collection name is required');
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('EpsilonDB: Invalid collection name (only a-z, 0-9, _, -)');
        const db = await this._getProfile();
        if (db.collections[name]) throw new Error(`EpsilonDB: Collection "${name}" already exists`);
        db.collections[name] = { documents: [] };
        await this._saveProfile(db);
        return { ok: true, name };
    }

    /** Delete a collection and all its documents */
    async deleteCollection(name) {
        const db = await this._getProfile();
        if (!db.collections[name]) throw new Error(`EpsilonDB: Collection "${name}" not found`);
        delete db.collections[name];
        await this._saveProfile(db);
        return { ok: true };
    }

    /** Return a CollectionProxy for chaining operations */
    collection(name) {
        return new EpsilonCollection(this, name);
    }
}

class EpsilonCollection {
    constructor(db, name) {
        this._db = db;
        this._name = name;
    }

    async _getCol() {
        const db = await this._db._getProfile();
        const col = db.collections?.[this._name];
        if (!col) throw new Error(`EpsilonDB: Collection "${this._name}" not found`);
        return { db, col };
    }

    /** Add a document. Returns the document with auto-generated _id, _created, _updated */
    async add(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('EpsilonDB: Document must be a non-null object');
        const { db, col } = await this._getCol();
        const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
        const now = new Date().toISOString();
        const doc = { _id: id, _created: now, _updated: now, ...data };
        col.documents.push(doc);
        await this._db._saveProfile(db);
        return doc;
    }

    /** Get all documents in the collection */
    async get() {
        const { col } = await this._getCol();
        return (col.documents || []).slice();
    }

    /** Get a single document by _id */
    async getById(id) {
        const { col } = await this._getCol();
        const doc = (col.documents || []).find(d => d._id === id);
        if (!doc) return null;
        return { ...doc };
    }

    /** Update a document by _id. Merges provided fields. */
    async update(id, data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('EpsilonDB: Update data must be a non-null object');
        const { db, col } = await this._getCol();
        const idx = col.documents.findIndex(d => d._id === id);
        if (idx === -1) throw new Error(`EpsilonDB: Document "${id}" not found`);
        col.documents[idx] = { ...col.documents[idx], ...data, _id: id, _updated: new Date().toISOString() };
        await this._db._saveProfile(db);
        return { ...col.documents[idx] };
    }

    /** Delete a document by _id */
    async delete(id) {
        const { db, col } = await this._getCol();
        const idx = col.documents.findIndex(d => d._id === id);
        if (idx === -1) throw new Error(`EpsilonDB: Document "${id}" not found`);
        const removed = col.documents.splice(idx, 1)[0];
        await this._db._saveProfile(db);
        return { ok: true, deleted: removed };
    }

    /** Count documents in the collection */
    async count() {
        const { col } = await this._getCol();
        return (col.documents || []).length;
    }
}

// Export for module environments, also set global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EpsilonDB, EpsilonCollection };
} else {
    window.EpsilonDB = EpsilonDB;
    window.EpsilonCollection = EpsilonCollection;
}
