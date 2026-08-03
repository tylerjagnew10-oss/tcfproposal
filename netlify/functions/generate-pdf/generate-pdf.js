// Netlify serverless function — generates clean PDF via DocRaptor API
// Called by report-render.html: POST /api/generate-pdf
//
// DocRaptor uses the Prince XML engine (gold standard HTML→PDF).
// No Puppeteer/Chromium needed — just a lightweight API call.
//
// Accepts JSON body: { html: '<full HTML>', filename: 'name' }
// Returns: PDF binary (application/pdf)

const DOCRAPTOR_API_KEY = '4yy_8MmigknbDVmNmpH6';
const SITE_URL = 'https://tcfproposals.netlify.app';

// CSS injected into every PDF to fix rendering in Prince XML engine.
// Key fixes:
//  - Cover strips: rgba(255,255,255,0.07) is near-invisible on dark bg → boost to 0.15
//  - PDF/A profile removed (was stripping gradients + transparency)
//  - CSS bg-image watermarks hidden (often fail in Prince server-side)
//  - Google Fonts loaded via absolute URL
const PRINT_FIX_CSS = `
  <style id="docraptor-fixes">
    /* Force all backgrounds and colors to print */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Cover page gradient */
    .cover {
      background: linear-gradient(135deg, #004766 0%, #001a2e 100%) !important;
    }

    /* Cover strip boxes — was rgba(255,255,255,0.07) which is near-invisible */
    .cover-strip {
      background: rgba(255,255,255,0.15) !important;
      border: 1px solid rgba(255,255,255,0.25) !important;
    }

    /* Group total banner */
    .group-total {
      background: linear-gradient(135deg, #004766, #002840) !important;
    }

    /* Site card header */
    .site-card-header {
      background: #004766 !important;
      color: white !important;
    }

    /* Next steps closing page */
    .next-steps-page {
      background: linear-gradient(135deg, #004766 0%, #001a2e 100%) !important;
    }

    /* Step number circles */
    .step-number {
      background: #004766 !important;
      color: white !important;
    }
    .step-number.done {
      background: #709c59 !important;
      color: white !important;
    }

    /* Hide CSS background-image watermarks (Prince can't load relative bg images) */
    .section::after { display: none !important; }
    .supp-attachment-watermark { display: none !important; }

    /* Remove overlay UI */
    #print-overlay { display: none !important; }
    body { padding-top: 0 !important; }
  </style>
`;

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = DOCRAPTOR_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'DocRaptor API key not configured' }),
    };
  }

  try {
    const { html, filename } = JSON.parse(event.body);

    if (!html) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing html parameter' }),
      };
    }

    let processedHTML = html;

    // 1. Fix relative image src → absolute Netlify URLs (so DocRaptor can fetch them)
    processedHTML = processedHTML.replace(
      /src=["'](?!https?:\/\/|data:)(images\/[^"']+)["']/g,
      (match, path) => `src="${SITE_URL}/${path}"`
    );

    // 2. Fix CSS url() with relative paths → absolute
    processedHTML = processedHTML.replace(
      /url\(["']?(?!https?:\/\/|data:)(images\/[^"')]+)["']?\)/g,
      (match, path) => `url('${SITE_URL}/${path}')`
    );

    // 3. Inject rendering fix CSS before </head>
    processedHTML = processedHTML.replace('</head>', PRINT_FIX_CSS + '\n</head>');

    // 4. Remove the print overlay div
    processedHTML = processedHTML.replace(
      /<div id="print-overlay"[\s\S]*?<\/div>/,
      ''
    );

    // Call DocRaptor API
    const response = await fetch('https://docraptor.com/docs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      },
      body: JSON.stringify({
        type: 'pdf',
        document_content: processedHTML,
        name: filename || 'TCF-Proposal',
        test: false,
        prince_options: {
          media: 'print',
          baseurl: SITE_URL + '/',
          // NOTE: No PDF/A profile — PDF/A strips gradients, opacity, and transparency
        },
        javascript: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DocRaptor error:', response.status, errText);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `DocRaptor returned ${response.status}: ${errText.substring(0, 300)}`,
        }),
      };
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const safeFilename = (filename || 'TCF-Proposal').replace(/[^a-zA-Z0-9_\-\.]/g, '-');

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };

  } catch (err) {
    console.error('generate-pdf error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'PDF generation failed' }),
    };
  }
};
