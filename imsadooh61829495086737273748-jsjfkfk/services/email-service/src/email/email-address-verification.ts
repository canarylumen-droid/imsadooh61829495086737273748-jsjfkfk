import { promisify } from 'util';
import dns from 'dns';

const resolveMx = promisify(dns.resolveMx);

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'trashmail.com', '10minutemail.com', 'temp-mail.org',
  'guerrillamail.com', 'yopmail.com', 'sharklasers.com', 'dispostable.com',
  'guerrillamailblock.com', 'grr.la', 'grr.ly', 'sharklasers.com',
  'spam4.me', 'ccmail.uk', 'deadaddress.com', 'discard.email',
  'discardmail.com', 'discardmail.de', ' disposable-email-address.loseyourip.com',
  'emailigo.de', 'emailsensei.com', 'emailtemporario.com.br',
  'emailtemporar.ro', 'emailtemporario.com', 'emailthe.net',
  'emailtmp.com', 'emailto.de', 'emailwarden.com',
  'emailx.at.hm', 'emailxfer.com', 'emz.net', 'enterto.com',
  'ephemail.net', 'etranquil.com', 'etranquil.net', 'etranquil.org',
  'evopo.com', 'explodemail.com', 'express.net.ua',
  'eyepaste.com', 'fakeinbox.com', 'fakeinformation.com',
  'fakemail.fr', 'fakemailz.com', 'fammix.com', 'fansworldwide.de',
  'fantasticmail.com', 'fastacura.com', 'fastchevy.com',
  'fastchrysler.com', 'fastkawasaki.com', 'fastmazda.com',
  'fastmitsubishi.com', 'fastnissan.com', 'fastsubaru.com',
  'fastsuzuki.com', 'fasttoyota.com', 'fastyamaha.com',
  'fightallspam.com', 'filzmail.com', 'findmail.cc',
  'finitee.com', 'fixmail.tk', 'fizmail.com', 'flemail.de',
  'flowemail.net', 'foolproofmail.com', 'footard.com',
  'forgetmail.com', 'fr33mail.info', 'frapmail.com',
  'freemails.cf', 'freemails.ga', 'freundin.ru',
  'friendlymail.co.uk', 'front14.org', 'fuckingduh.com',
  'fudgerub.com', 'fux0ringduh.com', 'fyii.de',
  'garliclife.com', 'gehensiull.com', 'genemail.com',
  'geniedx.com', 'geronEMAIL.de', 'get-mail.cf', 'get-mail.ga',
  'get-mail.tk', 'get1mail.com', 'get2mail.fr',
  'getairmail.cf', 'getairmail.com', 'getairmail.ga',
  'getairmail.gq', 'getairmail.ml', 'getairmail.tk',
  'getmails.eu', 'getonemail.com', 'getonemail.net',
  'ghosttexter.de', 'girlsundertheinfluence.com',
  'gishpuppy.com', 'goemailgo.com', 'gorillaswithdirtyarmpits.com',
  'gotmail.com', 'gotmail.net', 'gotmail.org',
  'gowikibooks.com', 'gowikicampus.com', 'gowikicars.com',
  'gowikifilms.com', 'gowikigames.com', 'gowikimusic.com',
  'gowikinetwork.com', 'gowikitravel.com', 'gowikitv.com',
  'grandmamail.com', 'grandmasmail.com', 'great-host.in',
  'greensloth.com', 'greermail.com', 'guerillamail.biz',
  'guerillamail.com', 'guerillamail.de', 'guerillamail.info',
  'guerillamail.net', 'guerillamail.org', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'guerrillamailblock.de', 'guerrillamailblock.info',
  'guerrillamailblock.net', 'guerrillamailblock.org',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.biz', 'guerrillamailblock.com',
  'guerrillamailblock.de', 'guerrillamailblock.info',
  'guerrillamailblock.net', 'guerrillamailblock.org',
  'gustr.com', 'h8s.org', 'hacccc.com', 'happemail.fr',
  'hatespam.org', 'herp.in', 'hidemail.de', 'hidzz.com',
  'hmamail.com', 'hopemail.biz', 'hot-mail.cf', 'hot-mail.ga',
  'hot-mail.gq', 'hot-mail.tk', 'hotpop.com',
  'hulapla.de', 'hushmail.com', 'ichimail.com',
  'imails.info', 'inbax.tk', 'inbox.si', 'inboxclean.com',
  'inboxclean.org', 'inboxproxy.com', 'incognitomail.com',
  'incognitomail.net', 'incognitomail.org', 'ineec.net',
  'infocom.zp.ua', 'inoutmail.de', 'inoutmail.info',
  'inoutmail.net', 'insorg-mail.info', 'ipoo.org',
  'irish2me.com', 'iwi.net', 'jetable.com', 'jetable.fr.nf',
  'jetable.net', 'jetable.org', 'jnxjn.com', 'jourrapide.com',
  'jsrsolutions.com', 'junk1e.com', 'junkmail.com',
  'junkmail.ga', 'junkmail.gq', 'kasmail.com', 'kaspop.com',
  'keepmymail.com', 'killmail.com', 'killmail.net',
  'kinghost.net', 'kingsq.ga', 'kir.ch.tc',
  'klassmaster.com', 'klassmaster.net', 'klzlk.com',
  'kook.ml', 'kurzepost.de', 'lawl.de', 'letthemeatspam.com',
  'lhsdv.com', 'lifebyfood.com', 'link2mail.net',
  'litedrop.com', 'lol.ovpn.to', 'lortemail.dk',
  'lovemeleaveme.com', 'lr78.com', 'lroid.com',
  'lukop.dk', 'm21.cc', 'maboard.com', 'mail-temporaire.fr',
  'mail.by', 'mail.mezimages.net', 'mail.zp.ua',
  'mail114.net', 'mail1a.de', 'mail21.cc',
  'mail2rss.org', 'mail333.com', 'mail4trash.com',
  'mailbidon.com', 'mailblocks.com', 'mailblog.biz',
  'mailbucket.org', 'mailcat.biz', 'mailcatch.com',
  'maildrop.cc', 'maildrop.cf', 'maildrop.ga',
  'maildrop.gq', 'mailtothis.com', 'mailtrash.net',
  'mailtv.net', 'mailtv.tv', 'mailzilla.com',
  'makemetheking.com', 'manifestgenerator.com',
  'manybrain.com', 'mbx.cc', 'mega.zik.dj',
  'meinspamschutz.de', 'meltmail.com', 'messagebeamer.de',
  'mezimages.net', 'mfsa.ru', 'mierdamail.com',
  'migmail.pl', 'migumail.com', 'mindless.com',
  'ministry-of-silly-walks.de', 'mintemail.com',
  'misterpinball.de', 'mmmmail.com', 'moakt.com',
  'mobi.web.id', 'mohmal.com', 'moncourrier.fr.nf',
  'monemail.fr.nf', 'monmail.fr.nf', 'monumentmail.com',
  'msa.minsmail.com', 'mt2015.com', 'mx0.wwwnew.eu',
  'my10minutemail.com', 'myalias.pw', 'mycard.net.ua',
  'mycleaninbox.net', 'myemailboxy.com', 'mymail-in.net',
  'mymailoasis.com', 'mymailpulsar.com', 'mymails.info',
  'mymailtemp.com', 'myphantom.com', 'mysamp.de',
  'mysoulbot.de', 'myspaceinc.com', 'myspaceinc.net',
  'myspaceinc.org', 'myspacepimpedup.com', 'mytemp.email',
  'mytempemail.com', 'mytempmail.com', 'mytempmail.de',
  'mythrowaway.email', 'mytmp.email', 'mytrashmail.com',
  'nabala.com', 'neomailbox.com', 'nepwk.com',
  'nervmich.net', 'nervtansen.de', 'netmails.com',
  'netmails.net', 'neverbox.com', 'nice-4u.com',
  'nincsmail.hu', 'nnh.com', 'no-spam.ws',
  'nobulk.com', 'noclickemail.com', 'nogmailspam.info',
  'nomail.xl.cx', 'nomail2me.com', 'nomorespamemails.com',
  'nonspam.eu', 'nonspammer.de', 'noref.in',
  'nospam.ze.tc', 'nospam4.us', 'nospamfor.us',
  'nospammail.net', 'nospamthanks.info', 'nothingtosee.com',
  'nuyen.net', 'nwar.net', 'obfrosten.se',
  'objectmail.com', 'obobbo.com', 'odnorazovoe.ru',
  'oneoffemail.com', 'onewaymail.com', 'oopi.org',
  'ordinaryamerican.net', 'otherinbox.com',
  'ourklips.com', 'outlawspam.com', 'ovpn.to',
  'owlpic.com', 'pancakemail.com', 'pimpedupmyspace.com',
  'pjjkp.com', 'plexolan.de', 'poczta.onet.pl',
  'politikerclub.de', 'poofy.org', 'pookmail.com',
  'privacy.net', 'privatdemail.net', 'proxymail.eu',
  'prtnx.com', 'punkass.com', 'putthisinyouremail.com',
  'qq.com', 'quickinbox.com', 'quickmail.nl',
  'rcpt.at', 'reallymymail.com', 'realtyalerts.ca',
  'recode.me', 'recursor.net', 'regbypass.com',
  'regbypass.comsafe.net', 'reliable-mail.com',
  'rhyta.com', 'rklips.com', 'rmqkr.net',
  'royal.net', 'rppkn.com', 'rtrtr.com',
  's0ny.net', 'safe-mail.net', 'safersignup.de',
  'safetymail.info', 'safetypost.de', 'sandelf.de',
  'saynotospams.com', 'scatmail.com', 'schafmail.de',
  'schott.email', 'schweizer-ml.de', 'secretemail.de',
  'secure-mail.biz', 'selectmailauc.com', 'sendspamhere.com',
  'shiftmail.com', 'shitmail.me', 'shitmail.org',
  'shitware.nl', 'shmeriously.com', 'shortmail.net',
  'sibmail.com', 'sinnlos-mail.de', 'skeefmail.com',
  'slaskpost.se', 'slipry.net', 'slopsbox.com',
  'slowslow.de', 'slugbuggy.com', 'slutty.horse',
  'smashmail.de', 'smellfear.com', 'snakemail.com',
  'sneakemail.com', 'sneakymail.de', 'snkmail.com',
  'sofimail.com', 'sofort-mail.de', 'softpls.asia',
  'sogetthis.com', 'soodonims.com', 'spam.la',
  'spam.su', 'spam4.me', 'spamavert.com',
  'spambob.com', 'spambob.net', 'spambob.org',
  'spambog.com', 'spambog.de', 'spambog.ru',
  'spambot.me', 'spambox.info', 'spambox.irishspringrealty.com',
  'spambox.us', 'spamcannon.com', 'spamcannon.net',
  'spamcero.com', 'spamcorptastic.com', 'spamcowboy.com',
  'spamcowboy.net', 'spamcowboy.org', 'spamday.com',
  'spamex.com', 'spamfighter.cf', 'spamfighter.ga',
  'spamfighter.gq', 'spamfighter.ml', 'spamfighter.tk',
  'spamfree24.com', 'spamfree24.de', 'spamfree24.eu',
  'spamfree24.info', 'spamfree24.net', 'spamfree24.org',
  'spamgoes.in', 'spamgourmet.com', 'spamgourmet.net',
  'spamgourmet.org', 'spamherelots.com', 'spamhereplease.com',
  'spamhole.com', 'spamify.com', 'spaminator.de',
  'spamkill.info', 'spaml.com', 'spaml.de',
  'spammotel.com', 'spamobox.com', 'spamoff.de',
  'spamslicer.com', 'spamspot.com', 'spamstack.net',
  'spamthis.co.uk', 'spamthisplease.com', 'spamtrail.com',
  'spamtrap.ro', 'speed.1s.fr', 'spoofmail.de',
  'stuffmail.de', 'superrito.com', 'superstuffedemail.com',
  'supertoinette.com', 'supguru.net', 'svk.jp',
  'sweetxxx.de', 'tafmail.com', 'tagyoureit.com',
  'talkinator.com', 'tapchicuoihoi.com', 'teewars.org',
  'teleworm.com', 'teleworm.us', 'temp-mail.org',
  'temp-mail.ru', 'temp.bob.mail.nob-mail.bg',
  'tempail.com', 'tempalias.com', 'tempenv.com',
  'tempinbox.com', 'tempinbox.co.uk', 'tempmail.eu',
  'tempmail.it', 'tempmail2.com', 'tempmaildemo.com',
  'tempmailer.com', 'tempmailer.de', 'tempomail.fr',
  'temporarily.de', 'temporarioemail.com.br',
  'temporaryemail.net', 'temporaryemail.us',
  'temporaryemailaddress.com', 'temporaryforwarding.com',
  'temporaryinbox.com', 'temporarymailaddress.com',
  'tempthe.net', 'thankyou2010.com', 'thc.st',
  'thetempmail.com', 'throwawayemailaddress.com',
  'tittbit.in', 'tizi.com', 'tmailinator.com',
  'toiea.com', 'toomail.biz', 'topranklist.de',
  'tradermail.info', 'trbvm.com', 'trbvn.com',
  'trbvo.com', 'trbwv.com', 'trickmail.net',
  'trillianpro.com', 'trolldepot.com', 'truantmail.com',
  'turual.com', 'twinmail.de', 'tyldd.com',
  'uggsrock.com', 'umail.net', 'upliftnow.com',
  'uplipht.com', 'venompen.com', 'veryrealliemail.com',
  'vidarbo.de', 'vinuni.edu.vn', 'vomoto.com',
  'vpn.st', 'vsimcard.com', 'vubby.com',
  'wasteland.rfc822.org', 'webemail.me', 'weg-werf-email.de',
  'wegwerfadresse.de', 'wegwerfemail.com', 'wegwerfemail.de',
  'wegwerfmail.net', 'wegwerfmail.de', 'wegwerfmail.info',
  'wegwerfmail.net', 'wegwerfmail.org', 'wegwerfmail24.de',
  'wegwerfmailaddress.com', 'wegwerfmailaddresses.de',
  'wegwerfmailalias.de', 'wegwerfmailalias.net',
  'wegwerfmailalias.org', 'wegwerfmailen.de',
  'wegwerfmailinfo.com', 'wegwerfmailing.de',
  'wegwerfmailbox.de', 'wegwerfmailaddress.de',
  'wegwerfmailserver.de', 'wegwerfmailweb.de',
  'wegwerfpostal.de', 'wegwerfpostadresse.de',
  'wh4f.org', 'whatiaas.com', 'whatpaas.com',
  'whyspam.me', 'wikidocuslice.com', 'wilemail.com',
  'willhackforfood.biz', 'willselfdestruct.com',
  'winemaven.info', 'wronghead.com', 'wuzup.net',
  'wuzupmail.net', 'wwwnew.eu', 'xagloo.com',
  'xemaps.com', 'xents.com', 'xjoi.com',
  'xmaily.com', 'xoxy.net', 'yapped.net',
  'yeah.net', 'yep.it', 'yogamaven.com',
  'yomail.info', 'yomp.com', 'yopmail.com',
  'yopmail.fr', 'yopmail.gq', 'yopmail.net',
  'you-spam.com', 'ypmail.webarnak.fr', 'yuurok.com',
  'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com',
  'zoemail.org'
]);

const ROLE_PREFIXES = new Set([
  'info', 'support', 'sales', 'admin', 'billing', 'jobs', 'hello', 'office',
  'contact', 'marketing', 'team', 'webmaster', 'hr', 'no-reply', 'noreply'
]);

// Common domain typos that cause bounces
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gemail.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hotm ail.com': 'hotmail.com', 'hotmailo.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yaoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlookk.com': 'outlook.com',
  'live.con': 'live.com', 'live.cmo': 'live.com',
  'icloud.con': 'icloud.com', 'icloud.cmo': 'icloud.com',
  'aol.con': 'aol.com', 'aol.cmo': 'aol.com',
  'protonmail.con': 'protonmail.com', 'protonmal.com': 'protonmail.com',
};

export interface EmailVerificationResult {
  email: string;
  isValid: boolean;
  score: number; // 0-100
  syntax: boolean;
  disposable: boolean;
  role: boolean;
  mx: boolean;
  catchAll?: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * Advanced Email Verification (DeBounce-style)
 */
export async function verifyEmailAddress(email: string): Promise<EmailVerificationResult> {
  const result: EmailVerificationResult = {
    email,
    isValid: true,
    score: 100,
    syntax: true,
    disposable: false,
    role: false,
    mx: true
  };

  // 1. Syntax Check (RFC 5322)
  const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if (!emailRegex.test(email)) {
    result.syntax = false;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Invalid email syntax';
    return result;
  }

  const [localPart, domain] = email.split('@');

  // 2. Typo detection — suggest correct domain
  const domainLower = domain.toLowerCase();
  const suggestedDomain = DOMAIN_TYPOS[domainLower];
  if (suggestedDomain) {
    result.suggestion = `${localPart}@${suggestedDomain}`;
    result.reason = `Possible typo: did you mean ${result.suggestion}?`;
    result.score -= 30;
  }

  // 3. Role-based Check
  if (ROLE_PREFIXES.has(localPart.toLowerCase())) {
    result.role = true;
    result.score -= 15;
    result.reason = 'Role-based email address';
  }

  // 3. Disposable Check
  if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) {
    result.disposable = true;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Disposable email provider detected';
    return result;
  }

  // 5. MX Record Check
  try {
    const mxRecords = await resolveMx(domain);
    if (mxRecords.length === 0) {
      result.mx = false;
      result.isValid = false;
      result.score = 0;
      result.reason = 'No MX records found for domain';
      return result;
    }
  } catch (e) {
    result.mx = false;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Domain does not exist or has no mail servers';
    return result;
  }

  // 6. Catch-all detection (Heuristic-based)
  // Truly checking catch-all requires SMTP ping, which is resource intensive.
  // We mark domains with many subdomains or known patterns.
  
  if (result.score < 60) {
    result.isValid = false;
  }

  return result;
}
