/**
 * Paper Detection Utilities for BioDAO
 *
 * This module provides functions to detect research papers in Discord messages.
 * It uses a combination of pattern matching, keyword detection, and heuristics
 * to identify when scientific papers are being shared.
 */

// Scientific paper domains commonly used for sharing research
const SCIENTIFIC_DOMAINS = [
  'arxiv.org',
  'biorxiv.org',
  'medrxiv.org',
  'nature.com',
  'science.org',
  'cell.com',
  'pnas.org',
  'ncbi.nlm.nih.gov',
  'pubmed.gov',
  'sciencedirect.com',
  'plos.org',
  'frontiersin.org',
  'jbc.org',
  'acs.org',
  'wiley.com',
  'springer.com',
  'tandfonline.com',
  'elsevier.com',
  'oup.com',
  'sage.com',
  'mdpi.com',
  'researchgate.net',
  'ssrn.com',
  'academia.edu',
  'figshare.com',
  'zenodo.org',
  'f1000research.com',
  'onlinelibrary.wiley.com',
  'link.springer.com',
  'journals.plos.org',
  'jmir.org',
  'nejm.org',
  'jamanetwork.com',
  'thelancet.com',
  'bmj.com',
];

// Scientific publishers and journals
const PUBLISHERS_AND_JOURNALS = [
  'elsevier',
  'springer',
  'wiley',
  'nature',
  'science',
  'cell',
  'plos',
  'pnas',
  'frontiers in',
  'journal of',
  'proceedings of',
  'acta',
  'advances in',
  'annual review',
  'biochemical',
  'biomedical',
  'biophysical',
  'scientific',
  'american journal',
  'european journal',
  'international journal',
  'molecular',
  'chemical',
  'pharmaceutical',
  'biological',
  'medical',
  'clinical',
  'research',
];

// Research-related keywords (multiple languages)
const RESEARCH_KEYWORDS = [
  'research',
  'study',
  'paper',
  'article',
  'publication',
  'published',
  'journal',
  'preprint',
  'manuscript',
  'doi',
  'peer-reviewed',
  'peer reviewed',
  'investigation',
  'experiment',
  'findings',
  'analysis',
  'methodology',
  'results',
  'conclusion',
  'abstract',
  'hypothesis',
  'thesis',
  'dissertation',
  'literature',
  'science',
  'scientific',
  'academic',
  'scholar',
  'review',
  'meta-analysis',
  'clinical trial',
  'randomized',
  'double-blind',
  'controlled',
  'cohort',
  'protocol',
  'bioRxiv',
  'medRxiv',
  'arXiv',
  'preprint server',
  'figure',
  'table',
  'supplementary',
  'authors',
  'et al',
  'volume',
  'issue',
  'pages',
  'citation',
  'impact factor',
  'data',
  'analysis',
  'statistik', // German
  'recherche', // French
  'étude', // French
  'estudio', // Spanish
  'investigación', // Spanish
  'pesquisa', // Portuguese
  'ricerca', // Italian
  'undersøgelse', // Danish
  'studie', // Dutch/German
  'исследование', // Russian
  '研究', // Chinese/Japanese
  '논문', // Korean
];

// File formats common for research papers
const PAPER_FILE_FORMATS = ['.pdf', '.doc', '.docx', '.tex', '.rtf', 'application/pdf'];

/**
 * Detects if a message contains a scientific paper reference
 * This updated version is more strict and only detects papers with high confidence
 * to prevent false positives
 *
 * @param message The message content to analyze
 * @param hasAttachments Whether the message has file attachments
 * @returns Boolean indicating if a paper was detected
 */
export function detectPaper(message: string, hasAttachments: boolean = false): boolean {
  const lowerMessage = message.toLowerCase();

  // Only count PDF attachments as papers if they exist
  if (hasAttachments) {
    // Check filename in message for PDF extension
    if (message.match(/\b\w+\.(pdf)\b/i)) {
      return true;
    }
  } else {
    // No attachments - require stronger evidence

    // Check for DOI patterns (strong evidence)
    if (message.match(/\b(doi:|doi\.org\/|10\.\d{4,}\/[\w\.\-\/]+)\b/i)) {
      return true;
    }

    // Check for specific scientific domain URLs
    const domainMatch = SCIENTIFIC_DOMAINS.some((domain) => {
      // Check for full URLs containing the domain
      return message.match(
        new RegExp(`https?:\/\/([\\w-]+\\.)*${domain.replace(/\./g, '\\.')}[\\/\\w\\.-]*`, 'i')
      );
    });

    if (domainMatch) {
      return true;
    }

    // Require extremely strong evidence for text-only detection
    // Must have:
    // 1. Paper title in quotes
    // 2. Author mention
    // 3. Year in parentheses or with publication date
    // 4. At least one journal/publisher name
    const hasPaperTitle = message.match(/["'"']([^"'"']{15,})["'"']/);
    const hasAuthor = message.match(/\b(?:by|authors?:?\s+|et\s+al\.?|and\s+colleagues)\b/i);
    const hasYear = message.match(/\b(19|20)\d{2}\b|\(\d{4}\)/);

    let hasJournalOrPublisher = false;
    for (const pub of PUBLISHERS_AND_JOURNALS) {
      // Check for exact publisher/journal name rather than substring
      if (message.match(new RegExp(`\\b${pub}\\b`, 'i'))) {
        hasJournalOrPublisher = true;
        break;
      }
    }

    // Only count as paper if we have all four criteria
    if (hasPaperTitle && hasAuthor && hasYear && hasJournalOrPublisher) {
      return true;
    }
  }

  // Default to not counting as a paper without strong evidence
  return false;
}

/**
 * Evaluates the quality of a paper reference
 * Higher scores indicate more definitive paper sharing
 * @param message The message content to analyze
 * @param hasAttachments Whether the message has file attachments
 * @returns Score from 0-100 indicating confidence level
 */
export function evaluatePaperQuality(message: string, hasAttachments: boolean = false): number {
  let score = 0;
  const lowerMessage = message.toLowerCase();

  // Direct PDF attachment or link is strong evidence
  if (hasAttachments && message.match(/\b\w+\.(pdf)\b/i)) {
    score += 70;
  }

  // DOI is very strong evidence
  if (message.match(/\b(doi:|doi\.org\/|10\.\d{4,}\/[\w\.\-\/]+)\b/i)) {
    score += 70;
  }

  // Scientific domain links
  for (const domain of SCIENTIFIC_DOMAINS) {
    if (
      message.match(
        new RegExp(`https?:\/\/([\\w-]+\\.)*${domain.replace(/\./g, '\\.')}[\\/\\w\\.-]*`, 'i')
      )
    ) {
      score += 50;
      break;
    }
  }

  // Publisher and journal names
  for (const publisher of PUBLISHERS_AND_JOURNALS) {
    if (message.match(new RegExp(`\\b${publisher}\\b`, 'i'))) {
      score += 10;
    }
  }

  // Research keywords
  for (const keyword of RESEARCH_KEYWORDS) {
    if (lowerMessage.includes(keyword.toLowerCase())) {
      score += 3;
    }
  }

  // Title patterns
  if (message.match(/\"([^\"]{15,})\"\s+(?:doi|https|http|\d{4})/i)) {
    score += 15;
  }

  // Presence of year and author pattern
  if (message.match(/\b(19|20)\d{2}\b.*et\s+al\.?/i)) {
    score += 15;
  }

  // Message contains text in the format "Title. Journal Name. Year"
  if (message.match(/[A-Z][\w\s]+\.\s+[A-Z][\w\s]+\.\s+(19|20)\d{2}/)) {
    score += 20;
  }

  score += 20;

  // Cap score at 100
  return Math.min(100, score);
}

/**
 * Extracts metadata from a message that contains a paper reference
 * @param message The message content to analyze
 * @returns Object with paper metadata or null if no paper detected
 */
export function extractPaperMetadata(message: string): {
  title?: string;
  authors?: string;
  year?: string;
  doi?: string;
  url?: string;
  confidence: number;
} | null {
  // Initialize metadata object with required confidence field
  const metadata: {
    title?: string;
    authors?: string;
    year?: string;
    doi?: string;
    url?: string;
    confidence: number;
  } = {
    confidence: 0,
  };

  // Extract DOI
  const doiMatch = message.match(/\b(doi:|doi\.org\/|10\.\d{4,}\/[\w\.\-\/]+)\b/i);
  if (doiMatch) {
    metadata.doi = doiMatch[0].replace(/^doi:|\bdoi\.org\//i, '');
    metadata.confidence += 30;
  }

  // Extract URL
  const urlMatch = message.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    metadata.url = urlMatch[0];
    metadata.confidence += 10;
  }

  // Extract year
  const yearMatch = message.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    metadata.year = yearMatch[0];
    metadata.confidence += 10;
  }

  // Extract title - looks for text in quotes or text followed by doi/year
  let titleMatch = message.match(/\"([^\"]{10,})\"/);
  if (titleMatch) {
    metadata.title = titleMatch[1];
    metadata.confidence += 20;
  } else {
    // Try to find title patterns
    titleMatch = message.match(
      /([A-Z][^\.]{15,})\.\s+(?:doi|https|http|\d{4}|journal|proceedings)/i
    );
    if (titleMatch) {
      metadata.title = titleMatch[1];
      metadata.confidence += 15;
    }
  }

  // Extract authors
  const authorMatch = message.match(
    /([A-Z][a-z]+\s+et\s+al\.?|(?:[A-Z][a-z]+(?:,\s*|&\s*)){2,}[A-Z][a-z]+)/
  );
  if (authorMatch) {
    metadata.authors = authorMatch[0];
    metadata.confidence += 15;
  }

  // Only return if we have enough confidence
  return metadata.confidence >= 20 ? metadata : null;
}

/**
 * Analyzes a PDF file to determine if it's likely a scientific paper
 *
 * @param filename The name of the PDF file
 * @param fileSize The size of the PDF in bytes (if available)
 * @returns Object with the analysis result and confidence score
 */
export function analyzeScientificPdf(
  filename: string,
  fileSize?: number
): {
  isScientificPaper: boolean;
  confidence: number;
  reason: string;
} {
  const lowerFilename = filename.toLowerCase();
  let confidence = 0;
  let reason = '';

  // Check file extension
  if (!lowerFilename.endsWith('.pdf')) {
    return {
      isScientificPaper: false,
      confidence: 100,
      reason: 'Not a PDF file',
    };
  }

  // Check for arXiv-style paper IDs (e.g., 2504.11091.pdf, arXiv:2504.11091.pdf)
  if (lowerFilename.match(/^(\d{4}\.\d{4,5}|arxiv[:\-_]?\d{4}\.\d{4,5})\.pdf$/i)) {
    confidence += 70;
    reason += 'arXiv-style paper ID pattern detected; ';
  }

  // Check for common paper naming patterns: AUTHOR_YEAR_TITLE.pdf, YEAR_TITLE.pdf, etc.
  if (lowerFilename.match(/^[a-z]+[_\-]+(19|20)\d{2}[_\-]+[a-z]/i)) {
    confidence += 40;
    reason += 'Author-Year-Title pattern detected; ';
  }

  // Check for DOI pattern in filename
  if (lowerFilename.match(/10\.\d{4,}\/[\w\.\-\/]+/)) {
    confidence += 50;
    reason += 'Contains DOI identifier; ';
  }

  // Check for year pattern (like 2020, 2021, etc.)
  if (lowerFilename.match(/(19|20)\d{2}/)) {
    confidence += 15;
    reason += 'Contains publication year; ';
  }

  // Check for common scientific paper filename patterns
  if (lowerFilename.match(/paper|research|study|journal|article|preprint|manuscript/)) {
    confidence += 20;
    reason += 'Contains scientific terminology; ';
  }

  // Check for author pattern (Last_First or similar)
  if (lowerFilename.match(/[a-z]+_[a-z]+/i)) {
    confidence += 10;
    reason += 'Contains author name pattern; ';
  }

  // Check for publisher names in filename
  for (const publisher of PUBLISHERS_AND_JOURNALS) {
    const pubLower = publisher.toLowerCase();
    if (lowerFilename.includes(pubLower)) {
      confidence += 25;
      reason += `Contains publisher name (${publisher}); `;
      break;
    }
  }

  // Check for numeric identifier patterns common in scientific papers
  if (lowerFilename.match(/^[a-z\d\-\_\.]+\d{2,}[a-z]?\.pdf$/i)) {
    confidence += 15;
    reason += 'Contains numeric identifier pattern; ';
  }

  // Check for common sci-paper abbreviations
  if (lowerFilename.match(/\b(fig|eq|tab|ref|vol|pp|et\s+al)\b/i)) {
    confidence += 15;
    reason += 'Contains scientific abbreviations; ';
  }

  // Check filename for very common non-scientific PDF types
  if (
    lowerFilename.match(/invoice|receipt|contract|agreement|form|application|resume|cv|certificate/)
  ) {
    confidence -= 40;
    reason += 'Contains non-scientific document terms; ';
  }

  // If we have file size, use it for additional context
  if (fileSize) {
    // Scientific papers are typically between 100KB and 20MB
    // Very small PDFs are unlikely to be full papers
    if (fileSize < 100 * 1024) {
      // Less than 100KB
      confidence -= 20;
      reason += 'File too small for typical paper; ';
    } else if (fileSize > 1024 * 1024 && fileSize < 20 * 1024 * 1024) {
      // 1MB to 20MB
      confidence += 10;
      reason += 'File size typical for scientific paper; ';
    }
  }

  // Add default confidence for any PDF to prevent zero confidence cases
  if (confidence === 0) {
    confidence = 30;
    reason += 'PDF file with no negative indicators; ';
  }
  confidence += 30;

  // Calculate final result
  const isScientificPaper = confidence >= 30;

  return {
    isScientificPaper,
    confidence,
    reason: reason || 'Insufficient evidence',
  };
}

export default {
  detectPaper,
  evaluatePaperQuality,
  extractPaperMetadata,
  analyzeScientificPdf,
  SCIENTIFIC_DOMAINS,
  RESEARCH_KEYWORDS,
  PUBLISHERS_AND_JOURNALS,
};
