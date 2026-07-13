declare module 'hpp' {
    import { RequestHandler } from 'express';
    function hpp(options?: {
        checkQuery?: boolean;
        checkBody?: boolean;
        whitelist?: string[];
    }): RequestHandler;
    export default hpp;
}
