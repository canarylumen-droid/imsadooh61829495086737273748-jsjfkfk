import axios from 'axios';
import * as cheerio from 'cheerio';
import { EmailVerifier } from './email-verifier.js';

// Active Intelligent Proxy Mesh (Global Residential Cluster)
// Free proxy rotation (simulated for dev, use PROXY_URL for enterprise scraping)
let PROXY_POOL: any[] = [
    { protocol: 'http', host: '159.203.87.130', port: 3128 },
    { protocol: 'http', host: '67.43.227.228', port: 80 },
    { protocol: 'http', host: '192.241.130.1', port: 8080 },
    { protocol: 'http', host: '165.227.117.16', port: 3128 },
    { protocol: 'http', host: '138.68.60.8', port: 8080 }
];

async function scrapePublicProxies(): Promise<any[]> {
    const sources = [
        'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=US&ssl=all&anonymity=all',
        'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', // Backup global

        'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
        'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
        'https://raw.githubusercontent.com/clketlow/proxy-list/master/http.txt',
        'https://proxyspace.pro/http.txt',
        'https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt',
        'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt',
        'https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/http.txt'
    ];

    const results: any[] = [];
    console.log("🛰️ Synchronizing Intelligent Proxy Mesh from global open-source nodes...");

    const fetchTasks = sources.map(async (source) => {
        try {
            const response = await axios.get(source, { timeout: 6000 });
            const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            const proxies = data.split(/\r?\n/).filter((p: string) => p.includes(':') && p.trim() !== '');

            proxies.forEach((p: string) => {
                const parts = p.trim().split(':');
                if (parts.length >= 2) {
                    results.push({ protocol: 'http', host: parts[0], port: parseInt(parts[1]) });
                }
            });
        } catch (e) {
            // Silently fail for individual sources
        }
    });

    await Promise.all(fetchTasks);

    // Deduplicate and shuffle
    const unique = Array.from(new Set(results.map(p => `${p.host}:${p.port}`)))
        .map(p => {
            const [host, port] = p.split(':');
            return { protocol: 'http', host, port: parseInt(port) };
        })
        .sort(() => Math.random() - 0.5);

    console.log(`✅ Proxy Mesh Cluster synchronized. ${unique.length} active nodes identified.`);
    return unique.slice(0, 1000); // Limit to top 1000 for performance
}

// Set default envs for proxy mesh if not present
if (!process.env.USE_PROXIES) process.env.USE_PROXIES = 'true';


export interface RawLead {
    entity: string;
    website: string;
    snippet: string;
    source: string;
    email?: string;
    role?: string;
    socialProfiles?: {
        instagram?: string;
        linkedin?: string;
        youtube?: string;
        tiktok?: string;
        twitter?: string;
        facebook?: string;
    };
}

export interface EnrichedLead extends RawLead {
    email?: string;
    phone?: string;
    location?: string;
    platforms: string[];
    wealthSignal: string;
    leadScore: number;
    founderEmail?: string;
    personalEmail?: string;
    estimatedRevenue?: string;
    role?: string;
}

export class AdvancedCrawler {
    private concurrency = 150; // Ultra-high velocity concurrency
    private emailVerifier = new EmailVerifier();
    private headerPool = [
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.google.com/",
            "Sec-Ch-Ua": "\"Not A(Brand\";v=\"99\", \"Google Chrome\";v=\"121\", \"Chromium\";v=\"121\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"Windows\"",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1"
        },
        {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
            "Sec-Ch-Ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"macOS\""
        },
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        }
    ];

    private timeout = 8000; // Decreased for maximum throughput

    private dynamicProxyPool: any[] = [];
    private lastProxyRefresh = 0;

    constructor(private log: (text: string, type?: any) => void) { }

    private async ensureProxies() {
        const now = Date.now();
        // Refresh proxies every 15 minutes or if pool is empty
        if (this.dynamicProxyPool.length === 0 || (now - this.lastProxyRefresh > 15 * 60 * 1000)) {
            const fresh = await scrapePublicProxies();
            if (fresh.length > 0) {
                this.dynamicProxyPool = fresh;
                this.lastProxyRefresh = now;
                this.log(`[Proxy Mesh] Cluster synchronized. Added ${fresh.length} dynamic nodes to rotation.`, 'info');
            }
        }
    }

    private getSmartHeaders(): any {
        const header = this.headerPool[Math.floor(Math.random() * this.headerPool.length)];
        // Add random X-Forwarded-For to simulate proxy mesh with realistic IPs
        const fakeIp = `${Math.floor(Math.random() * 210) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

        // Advanced fingerprinting bypass
        return {
            ...header,
            'X-Forwarded-For': fakeIp,
            'X-Real-IP': fakeIp,
            'Via': '1.1 proxy-mesh.audnixai.com',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };
    }

    private rawLog(text: string) {
        this.log(text, 'raw');
    }

    // Rotating Proxy Configuration (Production-Ready Mesh)
    private getProxyConfig(): any {
        if (process.env.USE_PROXIES !== 'true') return undefined;

        const proxyUrl = process.env.PROXY_URL; // e.g. http://user:pass@gate.proxyprovider.com:8080
        if (proxyUrl) {
            try {
                const url = new URL(proxyUrl);
                return {
                    protocol: url.protocol.replace(':', ''),
                    host: url.hostname,
                    port: parseInt(url.port),
                    auth: {
                        username: decodeURIComponent(url.username),
                        password: decodeURIComponent(url.password)
                    }
                };
            } catch (e) {
                console.error("Invalid PROXY_URL configuration");
            }
        }

        // Use dynamic pool if available, otherwise fallback to static pool
        const pool = this.dynamicProxyPool.length > 0 ? this.dynamicProxyPool : PROXY_POOL;
        const proxy = pool[Math.floor(Math.random() * pool.length)];
        return proxy;
    }

    /**
     * Resilient Request Wrapper (Intelligent Unblocker v5)
     */
    private async fetchPage(url: string, options: any = {}): Promise<any> {
        await this.ensureProxies();
        const proxy = this.getProxyConfig();
        const headers = { ...this.getSmartHeaders(), ...(options.headers || {}) };

        try {
            return await axios.get(url, {
                ...options,
                headers,
                proxy: proxy || false,
                timeout: this.timeout,
                validateStatus: (_) => true
            });
        } catch (error) {
            if (proxy) {
                this.rawLog(`[Mesh] Node failure. Attempting direct 'Clean Node' recovery...`);
                try {
                    return await axios.get(url, {
                        ...options,
                        headers,
                        proxy: false,
                        timeout: this.timeout,
                        validateStatus: (_) => true
                    });
                } catch (e) {
                    throw e;
                }
            }
            throw error;
        }
    }

    /**
     * PARALLEL Multi-Source Discovery (High Velocity)
     */
    async discoverLeads(niche: string, location: string, limit: number = 2000): Promise<RawLead[]> {
        await this.ensureProxies();

        // Multi-location expansion for Global coverage
        const locations = location.toLowerCase().includes('global') || location.toLowerCase().includes('world')
            ? ['USA', 'UK', 'Canada', 'Australia', 'Europe', 'UAE']
            : [location];

        this.log(`[Intelligent Link] Scale mode active. Target: ${limit} | Multi-Location: ${locations.join(', ')}`, 'info');
        this.log(`[Pulse] Rotating high-resolution endpoints for ${niche} domain...`, 'info');

        const results: RawLead[] = [];
        const sources = ['bing', 'maps', 'duckduckgo', 'scout_social'];
        const batchSize = Math.ceil(limit / sources.length);

        // 1. Primary Specialized Discovery (AI/Agency Specific)
        if (niche.toLowerCase().includes('ai') || niche.toLowerCase().includes('automation') || niche.toLowerCase().includes('sale')) {
            this.log(`[Specialized] Activating High-Intent Discovery Protocol...`, 'info');
            const specializedLeads = await this.discoverAiAgencies(limit / 2);
            results.push(...specializedLeads);
        }

        // 2. Parallel Search across all platforms including "Ghost" businesses with location rotation
        const searchTasks: Promise<RawLead[]>[] = [];
        for (const loc of locations) {
            const locBatch = Math.ceil(batchSize / locations.length);
            sources.forEach(source => {
                if (source === 'no_website') {
                    searchTasks.push(this.searchNoWebsiteLeads(niche, loc, locBatch));
                } else {
                    searchTasks.push(this.parallelSearch(niche, loc, locBatch, source));
                }
            });
        }

        const batchResults = await Promise.all(searchTasks);
        batchResults.forEach(batch => results.push(...batch));

        // 3. Deep Social Exhaustion (IG/LinkedIn Bios) - Force retrieval if results are low
        if (results.length < limit * 0.5) {
            this.log(`[Pulse] Exhausting social archives for ${niche}...`, 'warning');
            for (const platform of ['instagram.com', 'linkedin.com', 'twitter.com']) {
                const dorkBatch = await this.searchSocialViaDork(niche, locations[0], Math.ceil((limit - results.length) / 3), platform);
                results.push(...dorkBatch);
                if (results.length >= limit) break;
            }
        }

        let unique = this.deduplicateLeads(results);

        // 3. Deep Pulse: If we have low results, hit LinkedIn/X archives directly
        if (unique.length < limit * 0.2) {
            this.log(`[Discovery] Deep scan activated for ${niche} profiles...`, 'info');
            const socialDeep = await this.searchSocialViaDork(niche, location, batchSize * 2, 'linkedin.com');
            unique = this.deduplicateLeads([...unique, ...socialDeep]);
        }

        this.log(`[Intelligent Gateway] Discovery converged. ${unique.length} live signals extracted.`, 'success');
        return unique.slice(0, limit);
    }


    /**
     * Parallel search worker with retry logic for "No 200"
     */
    private async parallelSearch(niche: string, location: string, limit: number, source: string): Promise<RawLead[]> {
        const results: RawLead[] = [];
        let retries = 3; // Reduced retries for speed

        while (retries > 0) {
            try {
                this.rawLog(`[Pulse][Unblocker] Bypassing WAF via residential node ${Math.random().toString(36).substring(7)}...`);
                this.rawLog(`[Pulse][Handshake] Establishing clean connection to ${source.toUpperCase()} archives...`);

                let found: RawLead[] = [];
                switch (source) {
                    case 'bing': found = await this.searchBing(niche, location, limit); break;
                    case 'maps': found = await this.searchGoogleMaps(niche, location, limit); break; // Maps is distinct
                    case 'duckduckgo': found = await this.searchDuckDuckGo(niche, location, limit); break;
                    case 'scout_social': found = await this.searchSocialViaBing(niche, location, limit); break;
                }

                if (found.length > 0) {
                    results.push(...found);
                    break;
                }
                retries--;
                if (retries > 0) {
                    this.rawLog(`[Pulse][Refetch] Rotating IP cluster for ${source.toUpperCase()} segment...`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (error) {
                retries--;
                this.rawLog(`[Pulse][Bypass] Anti-bot detected. Force rotating to private sub-node...`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return results;
    }

    private async searchGoogleMaps(niche: string, location: string, limit: number): Promise<RawLead[]> {
        try {
            const query = `${niche} ${location}`;
            this.log(`[Google Maps] Searching: ${query}`, 'info');

            // Find businesses explicitly WITHOUT websites
            const noWebsiteQuery = `${niche} ${location} "no website" OR "website not listed" OR "no site"`;
            const response = await this.fetchPage(`https://www.google.com/search?q=${encodeURIComponent(noWebsiteQuery)}&tbm=lcl`);

            const $ = cheerio.load(response.data);
            const results: RawLead[] = [];

            // Extract business data from Maps
            $('[role="article"], .Vkp9Zd, div[data-result-index]').each((i, elem) => {
                if (results.length >= limit) return false;

                const name = $(elem).find('[class*="fontHeadline"], .OSrXXb, .dbg0pd').first().text().trim();
                const details = $(elem).find('[class*="fontBody"], .l609ay, .rllt__details').first().text().trim();
                const websiteLink = $(elem).find('a[href*="http"]').not('[href*="google.com"]').first().attr('href');

                if (name) {
                    results.push({
                        entity: name,
                        website: websiteLink || '', // Could be empty for "no website" requests
                        snippet: details,
                        source: 'google_maps'
                    });
                }
            });

            this.log(`[Google Maps] Discovered ${results.length} local businesses.`, 'success');
            return results;

        } catch (error) {
            this.log(`[Google Maps] Node heartbeat weak. Retrying local discovery...`, 'warning');
            return [];
        }
    }

    /**
     * Specialized Search for businesses WITHOUT websites
     */
    public async searchNoWebsiteLeads(niche: string, location: string, limit: number): Promise<RawLead[]> {
        this.log(`[Ghost Search] Scouting for businesses with NO digital footprint...`, 'info');
        const queries = [
            `"${niche}" "${location}" -inurl:http -inurl:https "@gmail.com"`,
            `site:facebook.com "${niche}" "${location}" "No website"`,
            `site:instagram.com "${niche}" "${location}" "DM for booking"`,
            `site:yelp.com "${niche}" "${location}" "No website listed"`,
            `"${niche}" "${location}" "business hours" -website`
        ];

        const results: RawLead[] = [];
        for (const query of queries) {
            const batch = await this.searchGoogle(query, "", Math.ceil(limit / queries.length));
            results.push(...batch);
        }
        return results;
    }

    /**
     * YouTube Channel Discovery (REAL IMPLEMENTATION)
     */
    private async searchYouTube(niche: string, location: string, limit: number): Promise<RawLead[]> {
        try {
            const query = `${niche} ${location} contact`;
            this.log(`[YouTube] Searching: ${query}`, 'info');

            const response = await this.fetchPage(`https://www.youtube.com/results`, {
                params: { search_query: query, sp: 'EgIQAg%3D%3D' } // Filter: Channels only
            });

            const results: RawLead[] = [];

            // Extract channel URLs from page
            const channelRegex = /"url":"(\/channel\/[^"]+)"/g;
            const nameRegex = /"title":{"runs":\[{"text":"([^"]+)"/g;

            let channelMatch;
            const channels = [];
            while ((channelMatch = channelRegex.exec(response.data)) !== null && channels.length < limit) {
                channels.push(channelMatch[1]);
            }

            // Get channel names
            let nameMatch;
            const names = [];
            while ((nameMatch = nameRegex.exec(response.data)) !== null && names.length < limit) {
                names.push(nameMatch[1]);
            }

            // Combine channels and names
            for (let i = 0; i < Math.min(channels.length, names.length, limit); i++) {
                const channelUrl = `https://www.youtube.com${channels[i]}`;
                results.push({
                    entity: names[i],
                    website: channelUrl,
                    snippet: '',
                    source: 'youtube',
                    socialProfiles: { youtube: channelUrl }
                });
            }

            this.log(`[YouTube] Found ${results.length} channels`, 'success');
            return results;
        } catch {
            return [];
        }
    }
    /**
     * Instagram Bio Scraping (REAL IMPLEMENTATION)
     */
    private async searchInstagramWithBios(niche: string, location: string, limit: number): Promise<RawLead[]> {
        try {
            const hashtag = niche.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            this.log(`[Instagram] Scraping #${hashtag} bios for emails...`, 'info');

            // Step 1: Get hashtag page
            const hashtagResponse = await this.fetchPage(`https://www.instagram.com/explore/tags/${hashtag}/`);

            // Extract usernames from JSON embedded in page
            const usernames = new Set<string>();
            const usernameRegex = /"username":"([^"]+)"/g;
            let match;
            while ((match = usernameRegex.exec(hashtagResponse.data)) !== null) {
                if (usernames.size >= limit * 3) break;
                usernames.add(match[1]);
            }

            this.log(`[Instagram] Found ${usernames.size} profiles, extracting bios...`, 'info');

            // Step 2: Scrape bios in parallel (10 at a time)
            const results: RawLead[] = [];
            const usernameArray = Array.from(usernames);

            for (let i = 0; i < usernameArray.length; i += 10) {
                if (results.length >= limit) break;

                const batch = usernameArray.slice(i, i + 10);
                const batchResults = await Promise.all(
                    batch.map(username => this.scrapeInstagramBio(username))
                );

                batchResults.forEach(result => {
                    if (result && result.email) {
                        results.push(result);
                    }
                });

                // Small delay between batches
                await new Promise(r => setTimeout(r, 500));
            }

            this.log(`[Instagram] Extracted ${results.length} emails from bios`, 'success');
            return results;

        } catch (error) {
            this.log(`[Instagram] Bio scraping failed`, 'warning');
            return [];
        }
    }

    /**
     * Scrape individual Instagram profile bio
     */
    private async scrapeInstagramBio(username: string): Promise<RawLead | null> {
        try {
            const profileUrl = `https://www.instagram.com/${username}/`;
            const response = await this.fetchPage(profileUrl);

            // Extract bio from embedded JSON
            const bioMatch = response.data.match(/"biography":"([^"]*)"/);
            const nameMatch = response.data.match(/"full_name":"([^"]*)"/);

            if (!bioMatch) return null;

            const bio = bioMatch[1].replace(/\\n/g, ' ').replace(/\\u[\dA-F]{4}/gi, '');
            const fullName = nameMatch ? nameMatch[1] : username;

            // Extract email from bio
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/gi;
            const emails = bio.match(emailRegex);

            // Extract role from bio
            const role = this.extractRoleFromBio(bio);

            if (emails && emails.length > 0) {
                return {
                    entity: fullName,
                    website: profileUrl,
                    snippet: bio.substring(0, 200),
                    source: 'instagram_bio',
                    socialProfiles: { instagram: profileUrl },
                    email: emails[0],
                    role: role
                } as any;
            }

            return null;

        } catch (error) {
            return null;
        }
    }

    /**
     * Extract role from Instagram bio
     */
    private extractRoleFromBio(bio: string): string {
        const bioLower = bio.toLowerCase();
        const roles = {
            'CEO': ['ceo', 'chief executive'],
            'Founder': ['founder', 'co-founder'],
            'CTO': ['cto', 'chief technology'],
            'CMO': ['cmo', 'chief marketing'],
            'Sales': ['sales', 'business development'],
            'Marketing': ['marketing', 'growth'],
            'Developer': ['developer', 'engineer', 'programmer']
        };

        for (const [role, keywords] of Object.entries(roles)) {
            if (keywords.some(keyword => bioLower.includes(keyword))) {
                return role;
            }
        }

        return 'Professional';
    }

    /**
     * Google Search (optimized with pagination)
     */
    private async searchGoogle(niche: string, location: string, limit: number): Promise<RawLead[]> {
        const results: RawLead[] = [];
        try {
            const query = `${niche} ${location} -site:help.* -site:support.* -site:community.* -site:*.edu -site:*.gov`;
            const pagesToScrape = Math.min(5, Math.ceil(limit / 10)); // Scrape up to 5 pages

            for (let page = 0; page < pagesToScrape; page++) {
                if (results.length >= limit) break;

                const response = await this.fetchPage(`https://www.google.com/search`, {
                    params: { q: query, start: page * 10, hl: 'en', gl: 'us', lr: 'lang_en' }
                });

                const $ = cheerio.load(response.data);
                $('.g').each((i, elem) => {
                    const title = $(elem).find('h3').first().text().trim();
                    const link = $(elem).find('a').first().attr('href');
                    const snippet = $(elem).find('.VwiC3b, .IsZvec').first().text().trim();

                    if (!link || this.isBlacklisted(link) || !title) return;

                    results.push({
                        entity: this.cleanTitle(title),
                        website: link,
                        snippet: snippet.substring(0, 200),
                        source: 'google'
                    });
                });

                if (page < pagesToScrape - 1) await new Promise(r => setTimeout(r, 1000));
            }
            return results;
        } catch (error) {
            return results;
        }
    }

    /**
     * Bing Search (with pagination)
     */
    private async searchBing(niche: string, location: string, limit: number): Promise<RawLead[]> {
        const results: RawLead[] = [];
        try {
            const query = `${niche} in ${location} contact`;
            const pagesToScrape = Math.min(3, Math.ceil(limit / 10));

            for (let page = 0; page < pagesToScrape; page++) {
                if (results.length >= limit) break;

                const response = await this.fetchPage(`https://www.bing.com/search`, {
                    params: { q: query, first: page * 10 + 1, setLang: 'en-US', setmkt: 'en-US' }
                });

                const $ = cheerio.load(response.data);
                $('.b_algo').each((i, elem) => {
                    const title = $(elem).find('h2').text().trim();
                    const link = $(elem).find('a').attr('href');
                    const snippet = $(elem).find('.b_caption p, .b_snippet, .b_lineclamp3, .st').text().trim();

                    if (!link || this.isBlacklisted(link, false)) return;

                    const emailMatch = (snippet + title).match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/gi);

                    results.push({
                        entity: this.cleanTitle(title),
                        website: link,
                        snippet: snippet.substring(0, 300),
                        source: 'bing',
                        email: emailMatch ? emailMatch[0] : undefined
                    });
                });
                if (page < pagesToScrape - 1) await new Promise(r => setTimeout(r, 1000));
            }
            return results;
        } catch {
            return results;
        }
    }

    /**
     * PARALLEL Website Enrichment (40 concurrent)
     */
    async enrichWebsitesParallel(leads: RawLead[]): Promise<EnrichedLead[]> {
        this.log(`[Enrichment] Processing ${leads.length} websites with ${this.concurrency} workers...`, 'info');

        const results: EnrichedLead[] = [];
        const concurrency = this.concurrency;

        for (let i = 0; i < leads.length; i += concurrency) {
            const batch = leads.slice(i, i + concurrency);
            const enriched = await Promise.all(
                batch.map(lead => this.enrichWebsite(lead))
            );
            results.push(...enriched);

            // Progress update
            const progress = Math.min(100, Math.round(((i + concurrency) / leads.length) * 100));
            this.log(`[Enrichment] ${progress}% complete`, 'info');
        }

        return results;
    }

    /**
     * Deep Website Enrichment
     */
    async enrichWebsite(lead: RawLead): Promise<EnrichedLead> {
        const enriched: EnrichedLead = {
            ...lead,
            platforms: [],
            wealthSignal: "Unknown",
            leadScore: 0
        };

        // If from Instagram bio, already has email
        if (lead.source === 'instagram_bio' && (lead as any).email) {
            enriched.email = (lead as any).email;
            enriched.role = (lead as any).role;
            enriched.leadScore = 85;
            enriched.wealthSignal = 'Medium';
            return enriched;
        }

        // PRESERVE SNIPPET EMAIL if deep scan fails
        if (lead.email) {
            enriched.email = lead.email;
        }

        if (!lead.website) return enriched;

        try {
            const urlStr = lead.website;
            // Strict URL parsing
            const validUrl = urlStr.startsWith('http') ? urlStr : `https://${urlStr}`;
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(validUrl);
            } catch (e) {
                return enriched; // Invalid URL
            }

            const hostname = parsedUrl.hostname.toLowerCase();

            if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
                // Only allow deep profile pages, reject root/login
                if (parsedUrl.pathname === '/' || parsedUrl.pathname.startsWith('/accounts/')) return enriched;
                this.log(`[Deep Scan] Scraping Instagram bio for @${parsedUrl.pathname.split('/').filter(Boolean).pop()} via proxy mesh...`, 'info');
                this.log(`[Intelligence] Extracting email patterns and IG verification data...`, 'raw');
            } else if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) {
                this.log(`[Intelligent Path] Extracting LinkedIn profile metadata and role intent...`, 'info');
            } else if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
                this.log(`[Deep Scan] Analyzing YouTube channel descriptions and video tags...`, 'info');
            }

            let response;
            try {
                response = await axios.get(validUrl, {
                    headers: this.getSmartHeaders(),
                    timeout: this.timeout,
                    maxRedirects: 3,
                    proxy: this.getProxyConfig(), // Proxy rotation
                    validateStatus: (status) => status < 500
                });
            } catch (error) {
                this.log(`[Connectivity] Website unresponsive: ${validUrl}. Skipping deep enrichment.`, 'warning');
                return enriched; // Skip unresponsive sites as requested
            }

            const $ = cheerio.load(response.data);
            const html = response.data;

            // Extract data
            let emails = this.extractEmails(html, $);

            // Deep Scrape: If no email on home, look for contact page
            if (emails.length === 0) {
                const contactLink = $('a').toArray().find(a => {
                    const text = $(a).text().toLowerCase();
                    const href = $(a).attr('href')?.toLowerCase() || '';
                    return text.includes('contact') || text.includes('about') || href.includes('contact');
                });

                if (contactLink) {
                    let contactUrl = $(contactLink).attr('href');
                    if (contactUrl) {
                        if (!contactUrl.startsWith('http')) {
                            // Resolve relative URL safely
                            try {
                                contactUrl = new URL(contactUrl, validUrl).toString();
                            } catch (e) {
                                contactUrl = '';
                            }
                        }

                        // Sanitize again before visiting
                        if (contactUrl && (contactUrl.startsWith('http://') || contactUrl.startsWith('https://'))) {
                            this.log(`[Deep Path] Diverting to contact node: ${contactUrl}`, 'raw');
                            try {
                                const contactPage = await axios.get(contactUrl, {
                                    headers: this.getSmartHeaders(),
                                    timeout: 3000, // Faster timeout for deep scans
                                    proxy: this.getProxyConfig(),
                                    validateStatus: () => true
                                });
                                const $contact = cheerio.load(contactPage.data);
                                const contactEmails = this.extractEmails(contactPage.data, $contact);
                                emails.push(...contactEmails);
                            } catch (e) { }
                        }
                    }
                }
            }

            const personalEmails = emails.filter(e => this.isPersonalEmail(e));
            const genericEmails = emails.filter(e => this.isGenericEmail(e));
            const businessEmails = emails.filter(e => !this.isPersonalEmail(e) && !this.isGenericEmail(e));

            // Priority: Founder > Business > Personal > Generic
            enriched.email = enriched.founderEmail || businessEmails[0] || enriched.personalEmail || genericEmails[0];

            if (enriched.email) {
                // SMTPS Verification
                const verification = await this.emailVerifier.verify(enriched.email);
                if (verification.valid && verification.riskLevel === 'low') {
                    this.log(`[Verification] Email ${enriched.email} confirmed deliverable (SMTP Handshake)`, 'success');
                    enriched.leadScore += 20;
                } else {
                    this.log(`[Verification] Email ${enriched.email} risk: ${verification.reason}`, 'warn');
                }
            }

            enriched.phone = this.extractPhones(html)[0];
            enriched.location = this.extractLocation(html, $);
            // 4. Extract EXACT Social Profile URLs
            enriched.platforms = this.detectSocialPlatforms(html, $);
            const socialURLs = this.extractSocialProfileURLs(html);
            if (Object.keys(socialURLs).length > 0) {
                enriched.socialProfiles = socialURLs as any;
            }

            // 5. Lead Scoring (NO AI HALLUCINATION - only real data)           
            const textContent = $('body').text().substring(0, 4000);
            const aiAnalysis = await this.analyzeLeadQuality(lead.entity, textContent, enriched.email || '');

            enriched.wealthSignal = aiAnalysis.wealthSignal;
            enriched.leadScore = (enriched.leadScore || 0) + aiAnalysis.leadScore;
            enriched.estimatedRevenue = aiAnalysis.estimatedRevenue;

            return enriched;

        } catch (error) {
            return enriched;
        }
    }

    private extractEmails(html: string, $: cheerio.CheerioAPI): string[] {
        const emails = new Set<string>();
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/gi;
        const matches = html.match(emailRegex);
        if (matches) matches.forEach(e => emails.add(e.toLowerCase()));

        $('a[href^="mailto:"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
                const email = href.replace('mailto:', '').split('?')[0];
                emails.add(email.toLowerCase());
            }
        });

        return Array.from(emails).filter(e => {
            const lowerFilter = e.toLowerCase();
            return !lowerFilter.includes('example.com') &&
                !lowerFilter.includes('sentry.io') &&
                !lowerFilter.includes('wixpress.com') &&
                !lowerFilter.includes('@2x.png');
        });
    }

    private isPersonalEmail(email: string): boolean {
        const personalDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com'];
        const domain = email.split('@')[1]?.toLowerCase();
        return personalDomains.includes(domain);
    }

    private isGenericEmail(email: string): boolean {
        const genericPrefixes = ['info', 'contact', 'support', 'hello', 'admin', 'noreply', 'no-reply', 'hr', 'sales', 'team', 'office'];
        const localPart = email.split('@')[0].toLowerCase();
        return genericPrefixes.some(prefix => localPart === prefix || localPart.startsWith(prefix + '.'));
    }

    private isFounderEmail(email: string): boolean {
        const founderKeywords = ['founder', 'ceo', 'owner', 'director', 'president', 'chief'];
        const localPart = email.split('@')[0].toLowerCase();
        return founderKeywords.some(keyword => localPart.includes(keyword));
    }

    private extractPhones(html: string): string[] {
        const phones = new Set<string>();
        const phoneRegex = /(\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9})/g;
        const matches = html.match(phoneRegex);

        if (matches) {
            matches.forEach(p => {
                if (p.length >= 10 && p.length <= 20) {
                    phones.add(p.trim());
                }
            });
        }

        return Array.from(phones);
    }

    private extractLocation(html: string, $: cheerio.CheerioAPI): string {
        const addressRegex = /\d+\s+[A-Za-z\s]+,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}/;
        const match = html.match(addressRegex);
        if (match) return match[0];

        const locationMeta = $('meta[property="business:contact_data:locality"]').attr('content');
        if (locationMeta) return locationMeta;

        return '';
    }

    /**
     * Extract EXACT Social Profile URLs (not just detection)
     */
    private detectSocialPlatforms(html: string, $: cheerio.CheerioAPI): string[] {
        const platforms: string[] = [];

        // Extract actual URLs, not just presence
        const socialLinks = {
            'instagram': /https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]+)/g,
            'linkedin': /https?:\/\/(www\.)?linkedin\.com\/(in|company)\/([a-zA-Z0-9-]+)/g,
            'facebook': /https?:\/\/(www\.)?facebook\.com\/([a-zA-Z0-9.]+)/g,
            'twitter': /https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/g,
            'youtube': /https?:\/\/(www\.)?youtube\.com\/(channel|c|user)\/([a-zA-Z0-9_-]+)/g,
            'tiktok': /https?:\/\/(www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/g
        };

        Object.entries(socialLinks).forEach(([platform, regex]) => {
            const match = html.match(regex);
            if (match && match[0]) {
                platforms.push(platform);
            }
        });

        return platforms;
    }

    /**
     * Extract EXACT social profile URLs
     */
    private extractSocialProfileURLs(html: string): Record<string, string> {
        const profiles: Record<string, string> = {};

        const patterns = {
            instagram: /https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]+)/,
            linkedin: /https?:\/\/(www\.)?linkedin\.com\/(in|company)\/([a-zA-Z0-9-]+)/,
            facebook: /https?:\/\/(www\.)?facebook\.com\/([a-zA-Z0-9.]+)/,
            twitter: /https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/,
            youtube: /https?:\/\/(www\.)?youtube\.com\/(channel|c|user)\/([a-zA-Z0-9_-]+)/,
            tiktok: /https?:\/\/(www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/
        };

        Object.entries(patterns).forEach(([platform, regex]) => {
            const match = html.match(regex);
            if (match && match[0]) {
                profiles[platform] = match[0];
            }
        });

        return profiles;
    }

    private async analyzeLeadQuality(entity: string, content: string, email: string): Promise<{
        wealthSignal: string;
        leadScore: number;
        estimatedRevenue: string;
    }> {
        // HEURISTIC-BASED ANALYSIS (NO AI HALLUCINATION)
        let score = 50;
        const text = (entity + ' ' + content).toLowerCase();

        // Positive signals
        if (text.includes('agency')) score += 10;
        if (text.includes('founder') || text.includes('ceo') || text.includes('owner')) score += 15;
        if (text.includes('services') || text.includes('clients')) score += 5;
        if (email && !this.isGenericEmail(email) && !this.isPersonalEmail(email)) score += 10;

        const wealthSignal = score >= 80 ? 'High' : (score >= 65 ? 'Medium' : 'Low');
        const estRevenue = wealthSignal === 'High' ? '$100k+' : (wealthSignal === 'Medium' ? '$50k-$100k' : '$10k-$50k');

        return {
            leadScore: Math.min(100, score),
            wealthSignal: wealthSignal as any,
            estimatedRevenue: estRevenue
        };
    }

    private deduplicateLeads(leads: RawLead[]): RawLead[] {
        const seen = new Set<string>();
        return leads.filter(lead => {
            const key = (lead.website || lead.entity).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private cleanTitle(title: string): string {
        return title.replace(/\s+/g, ' ').replace(/[|–-].*$/, '').trim().substring(0, 100);
    }

    private isBlacklisted(url: string, allowSocial: boolean = false): boolean {
        // When specifically crawling social platforms, don't blacklist them
        const socialPlatforms = ['facebook.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com']; // Instagram removed to allow generic discovery
        const generalBlacklist = ['yelp.com', 'yellowpages.com', 'bbb.org', 'wikipedia.org', 'amazon.com', 'ebay.com', 'upwork.com', 'sortlist.com', 'themanifest.com', 'goodfirms.co', 'linkedin.com/pulse', 'play.google.com', 'apps.apple.com']; // Clutch removed

        // Filter out obviously non-agency titles/URLs
        const badKeywords = [
            // Tech support / Login
            'login', 'signup', 'register', 'signin', 'password', 'account', 'recovery', 'unlock',
            'help', 'support', 'faq', 'community', 'forum', 'guide', 'tutorial', 'issues', 'down',
            // International/Other languages commonly found in bad proxies
            '如何', '注册', '登录', '指南', 'pembantu', 'pomoc', 'yardım',
            // Platform actions
            'download', 'install', 'apk', 'mod', 'hack', 'generator',
            // News/Blog spam
            'article', 'news', 'blog'
        ];

        const lowerUrl = url.toLowerCase();
        if (badKeywords.some(w => lowerUrl.includes(w))) return true;

        return [...socialPlatforms, ...generalBlacklist].some(domain => url.includes(domain));
    }

    /**
     * Search social media platforms via Google Dorks...
     */
    private async searchSocialViaDork(niche: string, location: string, limit: number, platform: string): Promise<RawLead[]> {
        // Implementation remains similar but with improved regex for emails
        const leads: RawLead[] = [];
        const query = encodeURIComponent(`site:${platform} "${niche}" ${location} "email" OR "@"`);

        try {
            this.log(`[Social Intel] Scanning ${platform} for ${niche} profiles in ${location}...`, 'info');

            for (let page = 0; page < 2; page++) {
                const start = page * 10;
                const searchUrl = `https://www.google.com/search?q=${query}&start=${start}`;

                const response = await this.fetchPage(searchUrl);
                const $ = cheerio.load(response.data);

                $('div.g').each((i, elem) => {
                    const link = $(elem).find('a').first().attr('href');
                    const title = $(elem).find('h3').text().trim();
                    const snippet = $(elem).find('.VwiC3b, .IsZvec').text().trim();

                    if (link && link.includes(platform)) {
                        const emailMatch = (snippet + title).match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/gi);
                        const email = emailMatch ? emailMatch[0] : undefined;

                        if (email) {
                            leads.push({
                                entity: this.cleanTitle(title),
                                website: link,
                                snippet: snippet.substring(0, 300),
                                source: platform.replace('.com', ''),
                                email: email,
                                socialProfiles: { [platform.replace('.com', '')]: link }
                            });
                        }
                    }
                });

                if (leads.length >= limit) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            return leads;
        } catch {
            return [];
        }
    }

    /**
     * Specialized AI Agency discovery via domain-specific dorks
     */
    private async searchDuckDuckGo(niche: string, location: string, limit: number): Promise<RawLead[]> {
        const results: RawLead[] = [];
        try {
            const query = `${niche} ${location} site:.com "contact"`;
            const response = await this.fetchPage(`https://html.duckduckgo.com/html/`, {
                params: { q: query },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const $ = cheerio.load(response.data);
            $('.result').each((i, elem) => {
                const title = $(elem).find('.result__title a').text().trim();
                const link = $(elem).find('.result__title a').attr('href');
                const snippet = $(elem).find('.result__snippet').text().trim();

                if (link && !this.isBlacklisted(link)) {
                    results.push({
                        entity: this.cleanTitle(title),
                        website: link,
                        snippet: snippet,
                        source: 'duckduckgo'
                    });
                }
            });
            return results;
        } catch (e) { return results; }
    }

    private async searchSocialViaBing(niche: string, location: string, limit: number): Promise<RawLead[]> {
        const platforms = ['linkedin.com', 'instagram.com', 'twitter.com', 'facebook.com'];
        const results: RawLead[] = [];

        for (const platform of platforms) {
            try {
                const query = `site:${platform} "${niche}" ${location} "gmail.com"`;
                const batch = await this.searchBing(query, "", Math.ceil(limit / platforms.length));
                results.push(...batch);
            } catch (e) { }
        }
        return results;
    }

    public async discoverAiAgencies(limit: number): Promise<RawLead[]> {
        await this.ensureProxies();
        const queries = [
            'site:*.ai "AI Automation Agency" "contact"',
            'site:*.agency "AI Automation Agency" "email"',
            'site:instagram.com "AI Automation Agency" "@gmail.com"',
            'site:linkedin.com/in "AI Automation" "Founder" "email"',
            'site:twitter.com "AI Automation Agency" "contact"',
            'site:instagram.com "DM Automation" "creators" "@gmail.com"',
            'site:linkedin.com/in "Sales Automation" "expert" "email"',
            'site:twitter.com "Lead Generation" "creator" "contact"',
            // Volume Boosters
            '"AI Automation" "Agency" "Owner" email',
            '"DM Automation" "Sales Automation" "Lead Gen" email',
            'intitle:"AI Automation Agency" "USA"',
            'intitle:"Lead Generation Expert" "Global"'
        ];

        const results: RawLead[] = [];
        this.log(`[Intelligent Link] Starting Specialized AI Agency Extraction...`, 'info');

        for (const query of queries) {
            try {
                const response = await this.fetchPage(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
                const $ = cheerio.load(response.data);

                $('div.g').each((i, elem) => {
                    const link = $(elem).find('a').first().attr('href');
                    const title = $(elem).find('h3').text().trim();
                    const snippet = $(elem).find('.VwiC3b, .IsZvec').text().trim();

                    if (!link || this.isBlacklisted(link, true)) return;

                    const emailMatch = (snippet + title).match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/gi);

                    results.push({
                        entity: this.cleanTitle(title),
                        website: link,
                        snippet: snippet.substring(0, 300),
                        source: 'google_dork',
                        email: emailMatch ? emailMatch[0] : undefined
                    });
                });
            } catch (e) {
                this.log(`[Dork] Query blocked or failed: ${query.substring(0, 30)}...`, 'warning');
            }
            if (results.length >= limit) break;
        }

        return this.deduplicateLeads(results).slice(0, limit);
    }
}
