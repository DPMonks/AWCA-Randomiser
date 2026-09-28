// Server-rendered HTML for the public business directory.
// Search engines read this markup directly. No browser script is required.

export const SITE_ORIGIN = "https://lottery.alconbury-weald.org";
export const MEMBERSHIP_URL = "https://www.alconbury-weald.org/membership-and-community-programs";
export const FALLBACK_IMAGE = `${SITE_ORIGIN}/icon-512.png`;

const DIRECTORY_TITLE = "Business supporters | Alconbury Weald";
const DIRECTORY_DESCRIPTION = "Local businesses supporting the Alconbury Weald Community Association. Browse AWCA Business Membership supporters in Alconbury Weald, Huntingdon, Cambridgeshire.";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function isSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ""));
}

export function businessPageTitle(name) {
  return `${name} | Alconbury Weald business supporter`;
}

export function businessPageDescription(name) {
  return `${name} is an AWCA Business Membership supporter in Alconbury Weald, Huntingdon, Cambridgeshire.`;
}

export function businessUrl(slug) {
  return `${SITE_ORIGIN}/businesses/${slug}`;
}

export function lastmodDay(value) {
  const text = String(value || "");
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) return "";
  const time = Date.parse(text.length === 10 ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(time)) return "";
  return match[1];
}

export function readSlug(req) {
  const query = req?.query;
  if (query && Object.prototype.hasOwnProperty.call(query, "slug")) {
    const value = query.slug;
    const raw = Array.isArray(value) ? value[0] : value;
    return String(raw ?? "").trim();
  }
  if (!req?.url) return "";
  try {
    const url = new URL(req.url, SITE_ORIGIN);
    const fromQuery = url.searchParams.get("slug");
    if (fromQuery) return fromQuery.trim();
    const match = url.pathname.match(/\/businesses\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

function jsonLdScript(data) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/ld+json">${json}</script>`;
}

export function localBusinessSchema(supporter) {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: supporter.name,
    areaServed: ["Alconbury Weald", "Huntingdon", "Cambridgeshire"],
  };
  if (supporter.logoUrl) {
    data.logo = supporter.logoUrl;
    data.image = supporter.logoUrl;
  }
  if (supporter.website) {
    data.url = supporter.website;
    data.sameAs = supporter.website;
  }
  return data;
}

function directorySchema(supporters) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Business supporters",
    description: DIRECTORY_DESCRIPTION,
    url: `${SITE_ORIGIN}/businesses`,
    isPartOf: {
      "@type": "WebSite",
      name: "AWCA Lottery",
      url: `${SITE_ORIGIN}/`,
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: supporters.map((supporter, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: supporter.name,
        url: businessUrl(supporter.slug),
      })),
    },
  };
}

function initialOf(name) {
  const char = String(name || "").trim().charAt(0).toLocaleUpperCase("en-GB");
  return char || "A";
}

function logoBlock(name, logoUrl) {
  if (!logoUrl) {
    return `<div class="logo initial" aria-hidden="true">${escapeHtml(initialOf(name))}</div>`;
  }
  return `<div class="logo"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name)} logo" referrerpolicy="no-referrer" /></div>`;
}

function websiteLink(supporter) {
  if (!supporter.website) return "";
  const href = escapeHtml(supporter.website);
  return `<a class="website-link" href="${href}">Visit website <span>${href}</span></a>`;
}

const CSS = `
    :root {
      --olive: #4f5139;
      --olive-dark: #3f412d;
      --cream: #f4f1e6;
      --cream-deep: #e6e1d0;
      --ink: #2c2d22;
      --muted: #5c5e48;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      background: var(--cream);
      color: var(--ink);
      font-family: "DM Sans", "Helvetica Neue", Arial, system-ui, sans-serif;
      line-height: 1.5;
    }
    a { color: var(--olive-dark); }
    .site-header {
      background: var(--olive);
      color: var(--cream);
    }
    .header-inner, .wrap, .site-footer-inner {
      max-width: 960px;
      margin: 0 auto;
      padding: 16px 20px;
    }
    .header-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand, .site-header a {
      color: var(--cream);
      text-decoration: none;
    }
    .brand { font-weight: 600; letter-spacing: 0.02em; }
    .site-header a:hover { text-decoration: underline; }
    .wrap { padding-top: 28px; padding-bottom: 48px; }
    h1 { font-weight: 500; font-size: 2rem; line-height: 1.2; margin: 0 0 8px; }
    .lede { margin: 0 0 22px; color: var(--muted); max-width: 42rem; }
    .grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }
    .card {
      background: #fff;
      border: 1px solid var(--cream-deep);
      border-radius: 4px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-link {
      color: inherit;
      text-decoration: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-link:hover h2, .card-link:focus h2 { text-decoration: underline; }
    .card h2 { font-size: 1.05rem; font-weight: 500; margin: 0; }
    .logo {
      background: #fff;
      border: 1px solid var(--cream-deep);
      border-radius: 3px;
      aspect-ratio: 4 / 3;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .logo img { max-width: 86%; max-height: 82%; object-fit: contain; }
    .logo.initial {
      background: var(--cream);
      color: var(--olive);
      font-size: 2.4rem;
      font-weight: 600;
    }
    .profile {
      display: grid;
      grid-template-columns: minmax(160px, 280px) 1fr;
      gap: 28px;
      align-items: start;
    }
    .kicker {
      margin: 0 0 6px;
      color: var(--olive);
      font-size: 0.85rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .website-link, .button {
      display: inline-block;
      background: var(--olive);
      color: var(--cream);
      text-decoration: none;
      border-radius: 4px;
      padding: 10px 14px;
      margin-top: 8px;
    }
    .website-link span, .card .website-link span {
      display: block;
      font-size: 0.82rem;
      font-weight: 400;
      opacity: 0.9;
      overflow-wrap: anywhere;
    }
    .card .website-link {
      text-align: center;
      margin-top: 0;
    }
    .website-link:hover, .button:hover { background: var(--olive-dark); }
    .back { margin-top: 22px; }
    .site-footer { border-top: 1px solid var(--cream-deep); }
    .site-footer p { margin: 0 0 6px; }
    @media (max-width: 640px) {
      .profile { grid-template-columns: 1fr; }
      h1 { font-size: 1.6rem; }
    }
`;

function documentPage({ title, description, canonical, image, imageAlt, robots, jsonLd, main, current }) {
  const canonicalTag = canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : "";
  const socialImage = image || FALLBACK_IMAGE;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="${escapeHtml(robots)}" />
  ${canonicalTag}
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical || `${SITE_ORIGIN}/businesses`)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Alconbury Weald Community Association" />
  <meta property="og:locale" content="en_GB" />
  <meta property="og:image" content="${escapeHtml(socialImage)}" />
  <meta property="og:image:alt" content="${escapeHtml(imageAlt || title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(socialImage)}" />
  <meta name="theme-color" content="#4f5139" />
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  ${jsonLd ? jsonLdScript(jsonLd) : ""}
  <style>${CSS}</style>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/">AWCA Lottery</a>
      <nav>
        <a href="/businesses"${current === "directory" ? ` aria-current="page"` : ""}>Business supporters</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    ${main}
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <p><a href="${MEMBERSHIP_URL}">Become a business supporter</a></p>
      <p><a href="/">Back to the AWCA Lottery</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

export function renderDirectoryPage(supporters) {
  const list = Array.isArray(supporters) ? supporters.filter((item) => item && item.name && item.slug) : [];
  const image = list.find((item) => item.logoUrl)?.logoUrl || FALLBACK_IMAGE;
  const cards = list.length
    ? `<ul class="grid">${list.map((supporter) => `
      <li class="card">
        <a class="card-link" href="/businesses/${escapeHtml(supporter.slug)}">
          ${logoBlock(supporter.name, supporter.logoUrl)}
          <h2>${escapeHtml(supporter.name)}</h2>
        </a>
        ${websiteLink(supporter)}
      </li>`).join("")}
    </ul>`
    : `<p class="lede">No business supporters are listed yet. AWCA Business Membership subscribers appear here automatically.</p>`;
  const main = `
    <h1>Business supporters</h1>
    <p class="lede">${escapeHtml(DIRECTORY_DESCRIPTION)}</p>
    ${cards}`;
  return documentPage({
    title: DIRECTORY_TITLE,
    description: DIRECTORY_DESCRIPTION,
    canonical: `${SITE_ORIGIN}/businesses`,
    image,
    imageAlt: "AWCA business supporters",
    robots: "index, follow",
    jsonLd: directorySchema(list),
    main,
    current: "directory",
  });
}

export function renderBusinessPage(supporter) {
  const title = businessPageTitle(supporter.name);
  const description = businessPageDescription(supporter.name);
  const main = `
    <article class="profile">
      ${logoBlock(supporter.name, supporter.logoUrl)}
      <div>
        <p class="kicker">Alconbury Weald business supporter</p>
        <h1>${escapeHtml(supporter.name)}</h1>
        <p class="lede">${escapeHtml(description)}</p>
        ${websiteLink(supporter)}
        <p class="back"><a href="/businesses">All business supporters</a></p>
      </div>
    </article>`;
  return documentPage({
    title,
    description,
    canonical: businessUrl(supporter.slug),
    image: supporter.logoUrl || FALLBACK_IMAGE,
    imageAlt: supporter.logoUrl ? `${supporter.name} logo` : title,
    robots: "index, follow",
    jsonLd: localBusinessSchema(supporter),
    main,
    current: "",
  });
}

export function renderStatusPage({ title, heading, message }) {
  const main = `
    <h1>${escapeHtml(heading)}</h1>
    <p class="lede">${escapeHtml(message)}</p>
    <p class="back"><a href="/businesses">All business supporters</a></p>`;
  return documentPage({
    title,
    description: message,
    canonical: "",
    image: FALLBACK_IMAGE,
    imageAlt: heading,
    robots: "noindex, follow",
    jsonLd: null,
    main,
    current: "",
  });
}

export function renderSitemap(supporters) {
  const list = (Array.isArray(supporters) ? supporters : []).filter((item) => item && isSlug(item.slug));
  const days = list.map((item) => lastmodDay(item.updatedAt)).filter(Boolean).sort();
  const latest = days[days.length - 1] || lastmodDay(new Date().toISOString());
  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: latest },
    { loc: `${SITE_ORIGIN}/businesses`, lastmod: latest },
    ...list.map((item) => ({
      loc: businessUrl(item.slug),
      lastmod: lastmodDay(item.updatedAt) || latest,
    })),
  ];
  const body = urls.map((url) => `  <url>
    <loc>${xmlEscape(url.loc)}</loc>
    <lastmod>${xmlEscape(url.lastmod)}</lastmod>
  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function sendBody(res, status, body, { contentType, cacheControl, robots }) {
  res.status(status);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cacheControl);
  if (robots) res.setHeader("X-Robots-Tag", robots);
  res.send(body);
}
