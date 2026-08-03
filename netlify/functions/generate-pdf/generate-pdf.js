// Netlify serverless function — generates clean PDF via DocRaptor API
// Called by report-render.html: POST /api/generate-pdf
//
// DocRaptor uses the Prince XML engine (gold standard HTML→PDF).
// No Puppeteer/Chromium needed — just a lightweight API call.
//
// Setup:
//   1. Sign up at https://docraptor.com (free test mode available)
//   2. Paste your API key below (replace YOUR_API_KEY_HERE)
//   3. Deploy to Netlify
//
// Accepts JSON body: { html: '<full HTML>', filename: 'name' }
// Returns: PDF binary (application/pdf)

// ┌─────────────────────────────────────────────────────┐
// │  PASTE YOUR DOCRAPTOR API KEY BELOW                 │
// │  Sign up free at: https://docraptor.com             │
// │  (Test mode generates watermarked PDFs — free)      │
// └─────────────────────────────────────────────────────┘
const DOCRAPTOR_API_KEY = '4yy_8MmigknbDVmNmpH6';

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
      body: JSON.stringify({ error: 'DocRaptor API key not configured — edit generate-pdf.js line 20' }),
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

    // Resolve relative image paths to absolute Netlify URLs
    // so DocRaptor can fetch them (it renders server-side)
    const siteUrl = process.env.URL || 'https://tcfproposals.netlify.app';
    let processedHTML = html;

    // Fix relative image src attributes: src="images/..." → src="https://site/images/..."
    processedHTML = processedHTML.replace(
      /src=["'](?!https?:\/\/|data:)(images\/[^"']+)["']/g,
      (match, path) => `src="${siteUrl}/${path}"`
    );

    // Fix relative CSS url() references: url('images/...') → url('https://site/images/...')
    processedHTML = processedHTML.replace(
      /url\(["']?(?!https?:\/\/|data:)(images\/[^"')]+)["']?\)/g,
      (match, path) => `url('${siteUrl}/${path}')`
    );

    // Remove the print overlay from the PDF output
    processedHTML = processedHTML.replace(
      /<div id="print-overlay"[\s\S]*?<\/div>/,
      ''
    );

    // Remove body padding-top (was for the overlay)
    processedHTML = processedHTML.replace(
      /padding-top:\s*56px;/g,
      'padding-top: 0;'
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
        test: apiKey === 'YOUR_API_KEY_HERE', // Auto-detect test mode
        prince_options: {
          media: 'print',        // Use @media print styles
          baseurl: siteUrl + '/', // Resolve any remaining relative URLs
          profile: 'PDF/A-1b',  // Archival quality
        },
        javascript: false, // HTML is already rendered, no JS needed
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DocRaptor error:', response.status, errText);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `DocRaptor returned ${response.status}: ${errText.substring(0, 200)}`,
        }),
      };
    }

    // Get PDF buffer
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
