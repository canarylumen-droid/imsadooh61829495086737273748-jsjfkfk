import { describe, it, expect } from 'vitest';

describe('Email Address Verification', () => {
  const disposableDomains = [
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.com',
    'yopmail.com', '10minutemail.com', 'guerrillamailblock.com', 'sharklasers.com',
    'grr.la', 'dispostable.com', 'maildrop.cc', 'temp-mail.org',
    'fakeinbox.com', 'tempinbox.com', 'mohmal.com', 'getnada.com',
    'emailondeck.com', '33mail.com', 'mytemp.email', 'burnermail.io',
    'harakirimail.com', 'tmail.ws', 'tmpmail.net', 'tmpmail.org',
    'discard.email', 'discardmail.com', 'mailsac.com', 'trashmail.com',
    'mailcatch.com', 'tempr.email', 'discardmail.de', 'spamgourmet.com',
    'mailexpire.com', 'mailzilla.com', 'jetable.org', 'nospam.ze.tc',
    'nomail.xl.cx', 'nospamfor.us', 'spamfree24.org', 'spamherelots.com',
    'tempinbox.co.uk', 'tempmailer.com', 'tempmailer.de', 'thankyou2010.com',
    'thisisnotmyrealemail.com', 'throwawayemailaddress.com', 'tittbit.in',
    'tradermail.info', 'trashemail.de', 'trashymail.com', 'trbvm.com',
    'trbvn.com', 'trbvo.com', 'uggsrock.com', 'weg-werf-email.de',
    'wegwerfadresse.de', 'wegwerfemail.com', 'wegwerfemail.de',
    'wegwerfmail.de', 'wetrainbayarea.com', 'wetrainbayarea.org',
    'wh4f.org', 'whatiaas.com', 'whatpaas.com', 'wilemail.com',
    'willhackforfood.biz', 'willselfdestruct.com', 'winemaven.info',
    'wronghead.com', 'wuzup.net', 'wuzupmail.net', 'wwwnew.eu',
    'xagloo.com', 'xemaps.com', 'xents.com', 'xjoi.com', 'xmaily.com',
    'xoxy.net', 'yapped.net', 'yeah.net', 'yep.it', 'yogamaven.com',
    'yomail.info', 'yomail.org', 'youdidntkno.com', 'your-mail.com',
    'zoaxe.com', 'zoemail.org', 'zehnminutenmail.de', 'guerrillamail.info',
    'guerrillamail.net', 'guerrillamail.org', 'grr.la', 'grr.ly',
    'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info',
    'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.de',
    'guerrillamailblock.net', 'guerrillamailblock.org', 'harakirimail.com',
    'jetable.org.nospam', 'jetable.fr.nospam', 'jetable.net.nospam',
    'maildrop.cc', 'mailexpire.com', 'mailforspam.com', 'mailguard.me',
    'mailhazard.com', 'mailhz.me', 'mailmate.com', 'mailme.ir',
    'mailme.lv', 'mailme24.com', 'mailmetome.com', 'mailmeuk.com',
    'mailnator.com', 'mailproxsy.com', 'mailquack.com', 'mailrock.biz',
    'mailscrap.com', 'mailshell.com', 'mailsiphon.com', 'mailslite.com',
    'mailtemp.info', 'mailtome.de', 'mailtothis.com', 'mailtrash.net',
    'mailtv.net', 'mailtv.tv', 'mailzilla.com', 'makemetheking.com',
    'manifestgenerator.com', 'manybrain.com', 'mbt-consult.com',
    'mega.zik.dj', 'meinspamschutz.de', 'meltmail.com', 'messagebeamer.de',
    'mezimages.net', 'mfsa.ru', 'mierdamail.com', 'migmail.pl',
    'migumail.com', 'mindless.com', 'ministry-of-silly-walks.de',
    'mintemail.com', 'misterpinball.de', 'mm5.co.uk', 'moakt.com',
    'mobi.web.id', 'mohmal.com', 'mohmal.in', 'mohmal.im',
    'moncourrier.fr.nospam', 'monemail.fr.nospam', 'monmail.fr.nospam',
    'monumentmail.com', 'msa.minsmail.com', 'mt2015.com',
    'mx0.wwwnew.eu', 'mypacks.net', 'mypartyclip.de', 'myphantom.com',
    'mysamp.de', 'myspaceinc.com', 'myspaceinc.net', 'myspaceinc.org',
    'myspacepimpedup.com', 'mytemp.email', 'mytempemail.com',
    'mytempmail.com', 'mythrowaway.email', 'mytrashmail.com',
    'nabala.com', 'neomailbox.com', 'nepwk.com', 'nervmich.net',
    'nervtansen.de', 'netmails.com', 'netmails.net', 'neverbox.com',
    'nice-4u.com', 'nincsmail.hu', 'nnh.com', 'nokiamail.hu',
    'nomail.xl.cx', 'nomail2me.com', 'nomorespamemails.com',
    'nonspam.eu', 'nonspammer.de', 'noref.in', 'nospam.ze.tc',
    'nospam4.us', 'nospamfor.us', 'nospammail.net', 'nospamthanks.info',
    'nothingtoseehere.ca', 'nowmymail.com', 'nurfuerspam.de',
    'nus.edu.sg', 'nwldx.com', 'objectmail.com', 'obobbo.com',
    'odnorazovoe.ru', 'oneoffemail.com', 'onewaymail.com',
    'oopi.org', 'ordinaryamerican.net', 'otherinbox.com',
    'ourklips.com', 'outlawspam.com', 'ovpn.to', 'owlpic.com',
    'pancakemail.com', 'pimpedupmyspace.com', 'pjjkp.com',
    'plexolan.de', 'poczta.onet.pl.nospam', 'politikerclub.de',
    'poofy.org', 'pookmail.com', 'privacy.net', 'privatdemail.net',
    'proxymail.eu', 'prtnx.com', 'punkass.com', 'putthisinyouremail.com',
    'qq.com', 'quickinbox.com', 'quickmail.nl', 'rcpt.at',
    'reallymymail.com', 'realtyalerts.ca', 'recode.me', 'recursor.net',
    'regbypass.com', 'regbypass.comsafe-mail.net', 'rejectmail.com',
    'reliable-mail.com', 'rhyta.com', 'rklips.com', 'rmqkr.net',
    'royal.net', 'rppkn.com', 'rtrtr.com', 's0ny.net',
    'safe-mail.net', 'safersignup.de', 'safetymail.info',
    'sandelf.de', 'saynotospams.com', 'scatmail.com', 'schafmail.de',
    'schrott-email.de', 'seckinmail.com', 'secure-mail.biz',
    'selfdestructingmail.com', 'sendspamhere.com', 'shiftmail.com',
    'shitmail.me', 'shitmail.org', 'shitware.nl', 'shmeriously.com',
    'shortmail.net', 'sibmail.com', 'sinnlos-mail.de', 'skeefmail.com',
    'slaskpost.se', 'slipry.net', 'slopsbox.com', 'slowslow.de',
    'slutty.horse', 'smashmail.de', 'smellfear.com', 'snakemail.com',
    'sneakemail.com', 'sneakymail.de', 'snkmail.com', 'sofimail.com',
    'sofort-mail.de', 'softpls.asia', 'sogetthis.com', 'soodonims.com',
    'spam.la', 'spam.su', 'spam4.me', 'spamavert.com',
    'spambob.com', 'spambob.net', 'spambob.org', 'spambog.com',
    'spambog.de', 'spambog.ru', 'spambogs.com', 'spambogs.de',
    'spambogs.ru', 'spambox.info', 'spambox.irishspringrealty.com',
    'spambox.us', 'spamcannon.com', 'spamcannon.net', 'spamcero.com',
    'spamcorptastic.com', 'spamcowboy.com', 'spamcowboy.net',
    'spamcowboy.org', 'spamday.com', 'spamex.com', 'spamfighter.cf',
    'spamfighter.ga', 'spamfighter.gq', 'spamfighter.ml', 'spamfighter.tk',
    'spamfree.eu', 'spamfree24.com', 'spamfree24.de', 'spamfree24.eu',
    'spamfree24.info', 'spamfree24.net', 'spamfree24.org', 'spamgourmet.com',
    'spamgourmet.net', 'spamgourmet.org', 'spamherelots.com',
    'spamhereplease.com', 'spamhole.com', 'spamify.com', 'spaminator.de',
    'spamkill.info', 'spaml.com', 'spaml.de', 'spammotel.com',
    'spamobox.com', 'spamoff.de', 'spamslicer.com', 'spamspot.com',
    'spamstack.net', 'spamthis.co.uk', 'spamthisplease.com',
    'spamtrail.com', 'spamtrap.ro', 'speed.1s.fr', 'spoofmail.de',
    'stuffmail.de', 'supergreatmail.com', 'supermailer.jp',
    'superrito.com', 'superstachel.de', 'suremail.info',
    'svk.jp', 'sweetxxx.de', 'tafmail.com', 'tagyoureit.com',
    'talkinator.com', 'tapchicuoihoi.com', 'teewars.org',
    'teleworm.com', 'teleworm.us', 'temp-mail.org', 'temp-mail.ru',
    'temp.bob.mail.ua', 'temp.headstrong.de', 'tempail.com',
    'tempalias.com', 'tempestry.com', 'tempinbox.com', 'tempinbox.co.uk',
    'tempmail.eu', 'tempmail.it', 'tempmail2.com', 'tempmaildemo.com',
    'tempmailer.com', 'tempmailer.de', 'tempomail.fr', 'temporarily.de',
    'temporarioemail.com.br', 'temporarioemail.com', 'temporaryemail.net',
    'temporaryemail.us', 'temporaryforwarding.com', 'temporaryinbox.com',
    'temporarymailaddress.com', 'tempthe.net', 'thankyou2010.com',
    'thc.st', 'thecloudindex.com', 'thetempmail.com', 'throwaway.email',
    'throwawayemailaddress.com', 'tittbit.in', 'tizi.com',
    'tmailinator.com', 'toiea.com', 'toomail.biz', 'topranklist.de',
    'tradermail.info', 'trash-amil.com', 'trash-mail.at',
    'trash-mail.com', 'trash-mail.de', 'trash-me.com', 'trash2009.com',
    'trashdevil.com', 'trashdevil.de', 'trashemail.de', 'trashmail.at',
    'trashmail.com', 'trashmail.de', 'trashmail.me', 'trashmail.net',
    'trashmail.org', 'trashmail.ws', 'trashmailer.com', 'trashmailer.de',
    'trashymail.com', 'trashymail.net', 'trillianpro.com',
    'turual.com', 'twinmail.de', 'tyldd.com', 'uggsrock.com',
    'umail.net', 'upliftnow.com', 'uplipht.com', 'venompen.com',
    'veryrealliemail.com', 'vidchart.com', 'viditag.com',
    'viewcastmedia.com', 'viewcastmedia.net', 'viewcastmedia.org',
    'vomoto.com', 'vpn.st', 'vsimcard.com', 'vubby.com',
    'wasteland.rfc822.org', 'webemail.me', 'weg-werf-email.de',
    'wegwerfadresse.de', 'wegwerfemail.com', 'wegwerfemail.de',
    'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
    'wetrainbayarea.com', 'wetrainbayarea.org', 'wh4f.org',
    'whatiaas.com', 'whatpaas.com', 'whyspam.me', 'wikidocuslice.com',
    'willhackforfood.biz', 'willselfdestruct.com', 'winemaven.info',
    'wronghead.com', 'wuzup.net', 'wuzupmail.net', 'wwwnew.eu',
    'xagloo.com', 'xemaps.com', 'xents.com', 'xjoi.com',
    'xmaily.com', 'xoxy.net', 'yapped.net', 'yeah.net',
    'yep.it', 'yogamaven.com', 'yomail.info', 'yomail.org',
    'youdidntkno.com', 'your-mail.com', 'yourbox.de', 'yukkumi.com',
    'zaizala.com', 'zepp.dk', 'zehnminutenmail.de', 'zoaxe.com',
    'zoemail.org', 'guerrillamail.info', 'guerrillamail.net',
    'guerrillamail.org', 'grr.la', 'grr.ly',
  ];

  const domainTypoMap: Record<string, string> = {
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com',
    'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'gmaul.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
    'hotamil.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmil.com': 'hotmail.com',
    'hotmeil.com': 'hotmail.com', 'hotmmail.com': 'hotmail.com', 'hoymail.com': 'hotmail.com',
    'hotnail.com': 'hotmail.com', 'yahhoo.com': 'yahoo.com', 'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yaoo.com': 'yahoo.com',
    'outloo.com': 'outlook.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com',
    'outlok.com': 'outlook.com', 'outlokk.com': 'outlook.com',
    'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'iclou.com': 'icloud.com',
    'iclound.com': 'icloud.com', 'icloud.co': 'icloud.com',
  };

  const roleAccounts = [
    'admin@example.com', 'info@example.com', 'support@example.com',
    'sales@example.com', 'contact@example.com', 'webmaster@example.com',
    'abuse@example.com', 'noc@example.com', 'security@example.com',
    'billing@example.com', 'help@example.com', 'office@example.com',
    'hr@example.com', 'marketing@example.com', 'legal@example.com',
    'postmaster@example.com', 'hostmaster@example.com', 'usenet@example.com',
    'uucp@example.com', 'news@example.com', 'marketing@example.com',
    'press@example.com', 'team@example.com', 'staff@example.com',
  ];

  function checkDisposableDomain(domain: string): boolean {
    return disposableDomains.includes(domain.toLowerCase());
  }

  function detectDomainTypo(domain: string): string | null {
    return domainTypoMap[domain.toLowerCase()] || null;
  }

  function isRoleAccount(email: string): boolean {
    const localPart = email.split('@')[0].toLowerCase();
    const rolePrefixes = [
      'admin', 'info', 'support', 'sales', 'contact', 'webmaster',
      'abuse', 'noc', 'security', 'billing', 'help', 'office',
      'hr', 'marketing', 'legal', 'postmaster', 'hostmaster', 'usenet',
      'uucp', 'news', 'press', 'team', 'staff',
    ];
    return rolePrefixes.includes(localPart);
  }

  describe('Disposable Domain Detection', () => {
    it('should detect known disposable domains', () => {
      expect(checkDisposableDomain('mailinator.com')).toBe(true);
      expect(checkDisposableDomain('guerrillamail.com')).toBe(true);
      expect(checkDisposableDomain('yopmail.com')).toBe(true);
      expect(checkDisposableDomain('10minutemail.com')).toBe(true);
      expect(checkDisposableDomain('tempmail.com')).toBe(true);
      expect(checkDisposableDomain('discard.email')).toBe(true);
    });

    it('should detect disposable domains case-insensitively', () => {
      expect(checkDisposableDomain('MAILINATOR.COM')).toBe(true);
      expect(checkDisposableDomain('GuerrillaMail.com')).toBe(true);
      expect(checkDisposableDomain('YOPMAIL.COM')).toBe(true);
    });

    it('should not flag legitimate domains', () => {
      expect(checkDisposableDomain('gmail.com')).toBe(false);
      expect(checkDisposableDomain('outlook.com')).toBe(false);
      expect(checkDisposableDomain('yahoo.com')).toBe(false);
      expect(checkDisposableDomain('company.com')).toBe(false);
      expect(checkDisposableDomain('university.edu')).toBe(false);
    });
  });

  describe('Domain Typo Detection', () => {
    it('should detect common Gmail typos', () => {
      expect(detectDomainTypo('gmial.com')).toBe('gmail.com');
      expect(detectDomainTypo('gmal.com')).toBe('gmail.com');
      expect(detectDomainTypo('gmaill.com')).toBe('gmail.com');
      expect(detectDomainTypo('gamil.com')).toBe('gmail.com');
      expect(detectDomainTypo('gmaul.com')).toBe('gmail.com');
      expect(detectDomainTypo('gnail.com')).toBe('gmail.com');
    });

    it('should detect common Hotmail typos', () => {
      expect(detectDomainTypo('hotmal.com')).toBe('hotmail.com');
      expect(detectDomainTypo('hotmial.com')).toBe('hotmail.com');
      expect(detectDomainTypo('hotamil.com')).toBe('hotmail.com');
      expect(detectDomainTypo('hotmil.com')).toBe('hotmail.com');
      expect(detectDomainTypo('hotmeil.com')).toBe('hotmail.com');
    });

    it('should detect common Yahoo typos', () => {
      expect(detectDomainTypo('yahhoo.com')).toBe('yahoo.com');
      expect(detectDomainTypo('yaho.com')).toBe('yahoo.com');
      expect(detectDomainTypo('yahooo.com')).toBe('yahoo.com');
      expect(detectDomainTypo('yaoo.com')).toBe('yahoo.com');
    });

    it('should detect common Outlook typos', () => {
      expect(detectDomainTypo('outloo.com')).toBe('outlook.com');
      expect(detectDomainTypo('outlok.com')).toBe('outlook.com');
      expect(detectDomainTypo('outlokk.com')).toBe('outlook.com');
    });

    it('should detect common iCloud typos', () => {
      expect(detectDomainTypo('iclod.com')).toBe('icloud.com');
      expect(detectDomainTypo('icoud.com')).toBe('icloud.com');
      expect(detectDomainTypo('iclou.com')).toBe('icloud.com');
      expect(detectDomainTypo('iclound.com')).toBe('icloud.com');
    });

    it('should return null for valid domains', () => {
      expect(detectDomainTypo('gmail.com')).toBe(null);
      expect(detectDomainTypo('outlook.com')).toBe(null);
      expect(detectDomainTypo('company.com')).toBe(null);
    });
  });

  describe('Role Account Detection', () => {
    it('should detect role accounts', () => {
      expect(isRoleAccount('admin@example.com')).toBe(true);
      expect(isRoleAccount('info@company.com')).toBe(true);
      expect(isRoleAccount('support@startup.io')).toBe(true);
      expect(isRoleAccount('sales@corp.com')).toBe(true);
      expect(isRoleAccount('contact@business.com')).toBe(true);
      expect(isRoleAccount('webmaster@site.com')).toBe(true);
    });

    it('should detect role accounts case-insensitively', () => {
      expect(isRoleAccount('ADMIN@example.com')).toBe(true);
      expect(isRoleAccount('Info@company.com')).toBe(true);
      expect(isRoleAccount('SUPPORT@startup.io')).toBe(true);
    });

    it('should not flag personal accounts', () => {
      expect(isRoleAccount('john@gmail.com')).toBe(false);
      expect(isRoleAccount('jane.doe@company.com')).toBe(false);
      expect(isRoleAccount('mike123@outlook.com')).toBe(false);
      expect(isRoleAccount('sarah@university.edu')).toBe(false);
    });
  });
});
