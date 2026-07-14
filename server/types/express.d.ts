import { User as DBUser } from "../../shared/schema";

declare global {
    namespace Express {
        interface User extends DBUser { }
    }
}

export { };
