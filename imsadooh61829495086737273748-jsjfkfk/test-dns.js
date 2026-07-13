import dns from 'dns';

dns.resolveMx('privatemail.com', (err, addresses) => {
    console.log("MX for privatemail.com:", err, addresses);
});

dns.resolve4('mail.privatemail.com', (err, addresses) => {
    console.log("A for mail.privatemail.com:", err, addresses);
});

dns.resolve6('mail.privatemail.com', (err, addresses) => {
    console.log("AAAA for mail.privatemail.com:", err, addresses);
});
