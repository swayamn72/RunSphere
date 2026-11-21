import type { FastifyInstance } from 'fastify';
import type { LegalContact } from '@runsphere/config';
import { LEGAL_PAGES, LEGAL_POLICY_VERSION, isDraftPolicy } from '@runsphere/domain';
import { page, securityHeaders } from './web-page.js';

/**
 * Privacy notice, terms and community guidelines (M8 C.2).
 *
 * Google Play needs a public privacy-policy URL for an app that uses location,
 * the DPDP Act needs an itemised notice, and the IT Rules 2021 need published
 * rules and a named grievance officer. Served by the API, like the deletion
 * pages, so they exist wherever the API does and need no separate website.
 *
 * Every statement here is meant to describe what the code actually does
 * (retention periods, what others can see, who processes data). Change the
 * text when the behaviour changes, and bump `LEGAL_POLICY_VERSION` so consent
 * records name the text that was shown. **This is a draft for legal review**
 * (C.7): while the version ends in `-draft` every page says so at the top.
 */

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const TO_BE_NAMED = '[to be named before launch]';

const contactBlock = (contact: LegalContact): string => {
  const operator = escapeHtml(contact.operatorName ?? TO_BE_NAMED);
  const officer = escapeHtml(contact.grievanceOfficerName ?? TO_BE_NAMED);
  const email = contact.grievanceOfficerEmail
    ? `<a href="mailto:${escapeHtml(contact.grievanceOfficerEmail)}">${escapeHtml(contact.grievanceOfficerEmail)}</a>`
    : TO_BE_NAMED;
  return `<h2>Contact and grievance officer</h2>
<p>RunSphere is run by ${operator}.</p>
<p>Grievance officer: ${officer}, ${email}. We acknowledge a complaint within 24 hours and resolve it
within 15 days. Questions about your data, or a request you couldn't complete in the app, go to the
same address.</p>`;
};

const draftBanner = isDraftPolicy()
  ? `<p class="draft"><strong>Draft.</strong> This text is waiting for legal review and is not yet in
force. Version ${LEGAL_POLICY_VERSION}.</p>`
  : `<p class="note">Version ${LEGAL_POLICY_VERSION}.</p>`;

const privacyBody = (contact: LegalContact): string => `${draftBanner}
<p>This notice explains what RunSphere collects when you use the app, why, who else sees it, how
long we keep it, and how you control it. RunSphere is for adults (18 or older) in India.</p>

<h2>What we collect and why</h2>
<ul>
<li><strong>Account:</strong> your email address and a password (stored only as a one-way hash),
your username, display name, chosen avatar and, if you pick one, your home area (a neighbourhood
name, never an address). Used to run your account and let friends find you.</li>
<li><strong>Age check:</strong> at sign-up you enter your date of birth so we can check you are 18
or older. We check it and then discard it; we keep only the fact that the check passed.</li>
<li><strong>Runs:</strong> while you are recording a run, your phone's precise location (GPS
points with times). We use it to measure your distance and time, check the run is genuine, and work
out the ground you claim in Turf. We record only while a run is in progress, never in the background
otherwise.</li>
<li><strong>Privacy zones:</strong> places you mark (for example home). We cut the part of every run
near them on our servers before anything is saved or shown.</li>
<li><strong>Run verification:</strong> if you choose to verify a run, your phone asks for your screen
lock. The check happens on your phone; we only learn whether it passed.</li>
<li><strong>Social and game activity:</strong> friends, clubs, challenges, blocks, reports you make,
territory claims, XP and achievements.</li>
<li><strong>Safety contacts:</strong> the email address of anyone you add as a safety contact, and
whether they accepted.</li>
<li><strong>Notifications:</strong> a push token for your device, and your notification and email
choices.</li>
<li><strong>Technical records:</strong> request logs with your IP address and device type, kept to
run and protect the service. They never contain your location or sign-in codes.</li>
</ul>
<p>We don't use advertising or analytics trackers, we don't sell your data, and we don't collect
photos, contacts from your address book, or health data such as heart rate.</p>

<h2>What other people can see</h2>
<ul>
<li>Your profile (username, display name, avatar, home area if you set one) is visible to
everyone and findable by username unless you change it: Profile → Settings → Privacy &amp; safety →
Privacy &amp; visibility lets you choose Friends or Only me, and turn off search.</li>
<li>Your claimed ground appears on the Turf map, with your name unless you turn that off in
the same privacy settings. Other runners don't see your route, start or finish, or run times.</li>
<li>Global leaderboards are off until you turn them on, and show only scores.</li>
<li>Club members see club results, never your route or location.</li>
<li>If you share a run with a safety contact, they see a rough area (at least 500 m across), at
least 15 minutes late, and only until the run ends or you stop sharing. RunSphere is not an
emergency service.</li>
</ul>

<h2>Who processes data for us</h2>
<p>We use service providers who process data only on our instructions: our hosting provider
${TO_BE_NAMED}, our email delivery provider ${TO_BE_NAMED}, and Google Firebase Cloud Messaging for
push notifications (which receives a device token and a notification id, never your location). Map
images load straight from OpenFreeMap, which sees your IP address and the part of the map you are
looking at. We share data with authorities only when Indian law requires it.</p>

<h2>How long we keep it</h2>
<ul>
<li>Raw GPS points from a run: 30 days, then deleted. The trimmed route and run summary stay until
you delete the run or your account.</li>
<li>Your account and everything linked to it: until you delete your account. Deletion signs you
out everywhere and erases your data within minutes.</li>
<li>After deletion we keep only a minimal record that an account was deleted (to prevent abuse),
email addresses that bounced or complained (so we never email them again), and staff audit records
that no longer identify you.</li>
</ul>

<h2>Your choices and rights</h2>
<ul>
<li><strong>See and download your data:</strong> Profile → Settings → Data → Export your data.</li>
<li><strong>Correct it:</strong> edit your profile, username and settings in the app.</li>
<li><strong>Delete it:</strong> delete your account in the app (Profile → Settings → Data → Delete account) or at
<a href="/account/delete">/account/delete</a>. This erases your runs too.</li>
<li><strong>Withdraw consent:</strong> turn off location for RunSphere in Android settings (you can
still browse), turn off leaderboards, safety sharing and news emails in the app, or delete your
account. Withdrawing doesn't undo what was done before.</li>
<li><strong>Nominate someone</strong> to use these rights for you if you die or can't act: write to
the grievance officer.</li>
<li><strong>Complain:</strong> to our grievance officer first. If you're not satisfied, you can
complain to the Data Protection Board of India.</li>
</ul>

<h2>How we protect it</h2>
<p>Runs waiting to upload are stored encrypted on your phone. Everything travels over HTTPS.
Passwords are hashed, staff access is limited by role and logged, and sign-in codes and locations
are kept out of our logs. If a breach affects your data, we will tell you and the Data Protection
Board as the law requires.</p>

<h2>Changes</h2>
<p>When this notice changes we will tell you in the app before the change applies to you.</p>
${contactBlock(contact)}`;

const termsBody = (contact: LegalContact): string => `${draftBanner}
<p>These terms are an agreement between you and the operator of RunSphere. By creating an account
you accept them and the <a href="${LEGAL_PAGES.communityGuidelines}">community guidelines</a>. Our
<a href="${LEGAL_PAGES.privacy}">privacy notice</a> explains how we handle your data.</p>

<h2>Who can use RunSphere</h2>
<p>You must be 18 or older and give true details at sign-up. One account per person. Keep your
password to yourself; you are responsible for what happens on your account.</p>

<h2>Run safely</h2>
<p>RunSphere is a game and a training tool, not medical advice and not an emergency service. Check
with a doctor before starting a new exercise routine. Obey traffic rules, never trespass to claim
ground, and stay aware of your surroundings. Don't use the app in a way that puts you or others at
risk.</p>

<h2>Fair play</h2>
<p>Record only runs you actually ran, on foot. Faking locations, using vehicles, sharing accounts,
or using tools to fake or automate activity is not allowed. We check runs automatically and may
reject runs, remove claims or XP, or suspend accounts that break these rules. You can appeal a
decision in the app.</p>

<h2>Games, territory and competitions</h2>
<p>Turf, seasons, challenges and competitions are free to play. Ground, XP, levels and badges have
no money value and can't be sold or exchanged. We may change, reset or end games and seasons.</p>

<h2>What you post</h2>
<p>You own your username, display name, club names and other things you add. You let us show them
in RunSphere so the app works. They must follow the community guidelines. We may remove content or
restrict accounts that break the rules, and we act on valid orders from Indian courts and
authorities.</p>

<h2>Ending your account</h2>
<p>You can delete your account at any time. We may suspend or close an account that seriously or
repeatedly breaks these terms; where possible we tell you why and how to appeal.</p>

<h2>Our responsibility</h2>
<p>We work to keep RunSphere available and accurate, but GPS and maps are not always exact and the
service may sometimes be unavailable. To the extent the law allows, we aren't responsible for
indirect losses from using the app. Nothing here limits rights you have under Indian consumer
law.</p>

<h2>Law and disputes</h2>
<p>These terms are governed by the laws of India. ${TO_BE_NAMED}: courts with jurisdiction.</p>
${contactBlock(contact)}`;

const guidelinesBody = (contact: LegalContact): string => `${draftBanner}
<p>RunSphere works when everyone feels safe on the road and on the map. These rules apply to your
username, display name, club names and descriptions, challenge names, and how you treat others.</p>

<h2>Be decent</h2>
<ul>
<li>No harassment, threats, bullying or hate based on who someone is.</li>
<li>No sexual, violent or shocking names or content.</li>
<li>Don't pretend to be someone else, or a brand or official body.</li>
<li>Don't post anyone's personal details, such as a phone number or where they live.</li>
<li>No spam, advertising, or anything illegal in India.</li>
</ul>

<h2>Play fair</h2>
<ul>
<li>Run your own runs, on foot. No faked locations, vehicles or shared accounts.</li>
<li>Don't follow, wait for, or track other runners because of what you see on the map.</li>
</ul>

<h2>Report and block</h2>
<p>Use Report on a runner to tell us about a problem, and Block to stop them seeing or reaching
you. The other person isn't told you blocked them. We review reports and may
warn, hide content, or suspend accounts. You can appeal a decision in the app.</p>
${contactBlock(contact)}`;

const titles = {
  privacy: 'Privacy notice',
  terms: 'Terms of use',
  communityGuidelines: 'Community guidelines'
} as const;

export const registerLegalPages = ({
  routes,
  contact
}: {
  routes: FastifyInstance;
  contact: LegalContact;
}) => {
  const bodies = {
    privacy: privacyBody(contact),
    terms: termsBody(contact),
    communityGuidelines: guidelinesBody(contact)
  };
  for (const key of Object.keys(LEGAL_PAGES) as (keyof typeof LEGAL_PAGES)[]) {
    const html = page(titles[key], bodies[key], '');
    routes.get(LEGAL_PAGES[key], { schema: { hide: true } }, async (_request, reply) =>
      reply.headers(securityHeaders).type('text/html; charset=utf-8').send(html)
    );
  }
};
