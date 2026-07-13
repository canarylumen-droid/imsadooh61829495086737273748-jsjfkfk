declare module 'google-it' {
  interface GoogleItOptions {
    query: string;
    limit?: number;
    disableConsole?: boolean;
    [key: string]: any;
  }

  function googleIt(options: GoogleItOptions): Promise<any[]>;
  
  export default googleIt;
}
