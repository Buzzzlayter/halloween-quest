import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import path from "node:path";

// Private server state: never place this file in the public static directory.
export class SqliteRoomStore {
  kind="sqlite";
  constructor(filename) {
    if(!filename || filename===":memory:")throw Error("SQLite requires a persistent database file.");
    filename=path.resolve(filename);
    mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename,{timeout:5000});
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS quest_rooms (
        code TEXT PRIMARY KEY CHECK(length(code)=6 AND code NOT GLOB '*[^0-9]*'),
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
        expires_at INTEGER NOT NULL,
        snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS quest_rooms_expiry ON quest_rooms(expires_at);`);
    this.read=this.db.prepare("SELECT revision,snapshot FROM quest_rooms WHERE code=?");
    this.add=this.db.prepare("INSERT INTO quest_rooms(code,expires_at,snapshot) VALUES(?,?,?) ON CONFLICT(code) DO NOTHING");
    this.swap=this.db.prepare("UPDATE quest_rooms SET revision=revision+1,expires_at=?,snapshot=? WHERE code=? AND revision=?");
    this.expire=this.db.prepare("DELETE FROM quest_rooms WHERE expires_at<?");
  }
  async check(){this.db.prepare("SELECT 1 FROM quest_rooms LIMIT 1").get();}
  async get(code){const row=this.read.get(code);return row?{revision:row.revision,snapshot:JSON.parse(row.snapshot)}:null;}
  async insert(room){return this.add.run(room.code,room.expiresAt,JSON.stringify(room)).changes===1;}
  async compareAndSwap(code,revision,room){
    return this.swap.run(room.expiresAt,JSON.stringify(room),code,revision).changes===1;
  }
  async removeExpired(now){this.expire.run(now);}
  close(){this.db.close();}
}
