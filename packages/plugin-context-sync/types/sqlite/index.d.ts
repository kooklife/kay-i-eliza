declare module "sqlite" {
    import { Database } from "sqlite3";

    export interface SqliteResult {
        value: string;
        [key: string]: any;
    }

    export interface Statement {
        get(...params: any[]): Promise<SqliteResult>;
        all(...params: any[]): Promise<any[]>;
        run(...params: any[]): Promise<any>;
        finalize(): Promise<void>;
    }

    export interface DatabaseOpen {
        filename: string;
        driver: typeof Database;
    }

    export function open(config: DatabaseOpen): Promise<{
        get(sql: string): Promise<SqliteResult>;
        all(sql: string): Promise<any[]>;
        run(sql: string): Promise<any>;
        close(): Promise<void>;
    }>;
}
