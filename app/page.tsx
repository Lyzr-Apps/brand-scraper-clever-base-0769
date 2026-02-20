'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { callAIAgent, uploadFiles } from '@/lib/aiAgent'
import type { AIAgentResponse } from '@/lib/aiAgent'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  FiUpload,
  FiDownload,
  FiSearch,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiFile,
  FiX,
  FiCheck,
  FiAlertCircle,
  FiEdit3,
  FiList,
  FiShield,
  FiInfo,
} from 'react-icons/fi'
import {
  FaTwitter,
  FaLinkedin,
  FaInstagram,
  FaFacebook,
  FaGlobe,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaYoutube,
  FaTiktok,
  FaPinterest,
} from 'react-icons/fa'

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_ID = '6998555cdad6f4a9e9c2e146'
const AGENT_NAME = 'Brand Research Agent'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SocialMedia {
  twitter: string
  linkedin: string
  instagram: string
  facebook: string
  youtube: string
  tiktok: string
  pinterest: string
}

interface ContactInfo {
  email: string
  phone: string
  hq_address: string
}

interface Brand {
  brand_name: string
  website_url: string
  website_scope: string
  confidence: string
  verification_notes: string
  logo_url: string
  founded_year: string
  about_summary: string
  about_page_link: string
  product_category: string
  social_media: SocialMedia
  contact_info: ContactInfo
  status: string
}

type SortField = 'brand_name' | 'product_category' | 'website_url' | 'founded_year' | 'status' | 'confidence'
type SortDirection = 'asc' | 'desc'
type ViewState = 'input' | 'results'
type InputMode = 'text' | 'csv'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isNotFound = (val: string | undefined | null): boolean => {
  if (!val) return true
  return val.trim().toLowerCase() === 'not found' || val.trim() === ''
}

const parseBrandText = (text: string): string[] => {
  // Supports: one per line, comma-separated, or mixed
  const lines = text
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase().replace(/['"]/g, '')
    return (
      lower !== 'brand' &&
      lower !== 'name' &&
      lower !== 'brand_name' &&
      lower !== 'brand name' &&
      lower !== 'company' &&
      lower !== 'company name'
    )
  })
  return filtered.map((l) => l.replace(/^["']|["']$/g, '').trim()).filter((l) => l.length > 0)
}

// ─── Deep extraction helpers ─────────────────────────────────────────────────

/** Try to parse a string as JSON, including markdown code block extraction */
const tryParseString = (s: string): unknown | null => {
  if (!s || typeof s !== 'string') return null
  const trimmed = s.trim()
  // Direct JSON parse
  try { return JSON.parse(trimmed) } catch {}
  // Extract from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch?.[1]) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch {}
  }
  // Extract first JSON object/array from text
  const jsonStart = trimmed.search(/[{\[]/)
  if (jsonStart >= 0) {
    try { return JSON.parse(trimmed.slice(jsonStart)) } catch {}
  }
  return null
}

/** Recursively resolve a value: if it's a string, try to parse it as JSON */
const resolveValue = (val: unknown, depth = 0): unknown => {
  if (depth > 5) return val
  if (typeof val === 'string') {
    const parsed = tryParseString(val)
    return parsed !== null ? resolveValue(parsed, depth + 1) : val
  }
  return val
}

/** Map a ChatGPT-schema result object to our Brand interface */
const mapChatGPTResult = (r: Record<string, unknown>): Brand => {
  const wd = r?.website_details as Record<string, unknown> | undefined
  const sm = wd?.social_media as Record<string, string> | undefined
  return {
    brand_name: (r?.brand_name as string) ?? '',
    website_url: (r?.selected_official_website as string) ?? (r?.official_website_turkey as string) ?? '',
    website_scope: (r?.website_scope as string) ?? '',
    confidence: (r?.confidence as string) ?? '',
    verification_notes: (r?.verification_notes as string) ?? '',
    logo_url: (wd?.logo_url as string) ?? '',
    founded_year: (wd?.founded_year as string) ?? '',
    about_summary: '',
    about_page_link: (wd?.about_page_link as string) ?? '',
    product_category: Array.isArray(wd?.product_categories)
      ? (wd.product_categories as string[]).join(', ')
      : (wd?.product_categories as string) ?? '',
    social_media: {
      twitter: sm?.twitter ?? '',
      linkedin: sm?.linkedin ?? '',
      instagram: sm?.instagram ?? '',
      facebook: sm?.facebook ?? '',
      youtube: sm?.youtube ?? '',
      tiktok: sm?.tiktok ?? '',
      pinterest: sm?.pinterest ?? '',
    },
    contact_info: {
      email: (wd?.contact_email as string) ?? '',
      phone: (wd?.contact_phone as string) ?? '',
      hq_address: '',
    },
    status: (r?.confidence as string)?.toLowerCase() === 'verified' ? 'Complete' : 'Partial',
  }
}

/**
 * Search an object for a brands array. Checks known keys and does
 * a shallow recursive search through object values.
 */
const findBrandsInObject = (obj: unknown, depth = 0): Brand[] | null => {
  if (depth > 4 || !obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    // Check if this IS a brands array (array of objects with brand_name)
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      const first = obj[0] as Record<string, unknown>
      if ('brand_name' in first) return obj as Brand[]
    }
    return null
  }
  const record = obj as Record<string, unknown>

  // Check standard keys
  for (const key of ['brands', 'results']) {
    const val = resolveValue(record[key])
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0]
      if (typeof first === 'object' && first !== null) {
        const firstRec = first as Record<string, unknown>
        if ('brand_name' in firstRec) {
          // Standard brand format
          return val as Brand[]
        }
        if ('website_details' in firstRec || 'selected_official_website' in firstRec) {
          // ChatGPT schema format
          return (val as Record<string, unknown>[]).map(mapChatGPTResult)
        }
      }
    }
  }

  // Check the 'text' key (normalizeResponse wraps strings as { text: "..." })
  if ('text' in record && typeof record.text === 'string') {
    const parsed = tryParseString(record.text)
    if (parsed) {
      const found = findBrandsInObject(parsed, depth + 1)
      if (found) return found
    }
  }

  // Check 'result' key
  if ('result' in record) {
    const resolved = resolveValue(record.result)
    const found = findBrandsInObject(resolved, depth + 1)
    if (found) return found
  }

  // Check 'response' key
  if ('response' in record) {
    const resolved = resolveValue(record.response)
    const found = findBrandsInObject(resolved, depth + 1)
    if (found) return found
  }

  // Check 'data' key
  if ('data' in record) {
    const resolved = resolveValue(record.data)
    const found = findBrandsInObject(resolved, depth + 1)
    if (found) return found
  }

  return null
}

const parseAgentResponse = (result: AIAgentResponse): Brand[] => {
  try {
    // Strategy 1: Check response.result directly
    const resultData = resolveValue(result?.response?.result)
    const fromResult = findBrandsInObject(resultData)
    if (fromResult && fromResult.length > 0) return fromResult

    // Strategy 2: Check the full response object
    const fromResponse = findBrandsInObject(result?.response)
    if (fromResponse && fromResponse.length > 0) return fromResponse

    // Strategy 3: Check the top-level result (entire API response)
    const fromTopLevel = findBrandsInObject(result)
    if (fromTopLevel && fromTopLevel.length > 0) return fromTopLevel

    // Strategy 4: Check raw_response string
    if (result?.raw_response) {
      const rawParsed = resolveValue(result.raw_response)
      const fromRaw = findBrandsInObject(rawParsed)
      if (fromRaw && fromRaw.length > 0) return fromRaw
    }

    // Strategy 5: Check if response.result itself is the brands array
    if (Array.isArray(resultData) && resultData.length > 0) {
      const first = resultData[0]
      if (typeof first === 'object' && first !== null && 'brand_name' in first) {
        return resultData as Brand[]
      }
    }

    return []
  } catch {
    return []
  }
}

const parseResponseMeta = (
  result: AIAgentResponse
): { total: number; complete: number; partial: number } => {
  try {
    // Search through multiple possible locations
    const candidates: unknown[] = [
      resolveValue(result?.response?.result),
      result?.response,
      result,
    ]
    if (result?.raw_response) {
      candidates.push(resolveValue(result.raw_response))
    }

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const obj = candidate as Record<string, unknown>

      // Check if text field contains JSON with meta
      if ('text' in obj && typeof obj.text === 'string') {
        const parsed = tryParseString(obj.text)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>
          if (typeof p.total_brands === 'number') {
            return {
              total: p.total_brands as number,
              complete: (p.complete_count as number) ?? 0,
              partial: (p.partial_count as number) ?? 0,
            }
          }
        }
      }

      if (typeof obj.total_brands === 'number') {
        return {
          total: obj.total_brands as number,
          complete: (obj.complete_count as number) ?? 0,
          partial: (obj.partial_count as number) ?? 0,
        }
      }
      // Check nested result
      if ('result' in obj) {
        const inner = resolveValue(obj.result)
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          const r = inner as Record<string, unknown>
          if (typeof r.total_brands === 'number') {
            return {
              total: r.total_brands as number,
              complete: (r.complete_count as number) ?? 0,
              partial: (r.partial_count as number) ?? 0,
            }
          }
        }
      }
    }
    return { total: 0, complete: 0, partial: 0 }
  } catch {
    return { total: 0, complete: 0, partial: 0 }
  }
}

const exportCSV = (brands: Brand[]) => {
  const headers = [
    'Brand Name',
    'Category',
    'Website',
    'Website Scope',
    'Confidence',
    'Verification Notes',
    'Logo URL',
    'Founded Year',
    'About Summary',
    'About Page',
    'Twitter',
    'LinkedIn',
    'Instagram',
    'Facebook',
    'YouTube',
    'TikTok',
    'Pinterest',
    'Email',
    'Phone',
    'HQ Address',
    'Status',
  ]
  const rows = brands.map((b) => [
    b?.brand_name,
    b?.product_category,
    b?.website_url,
    b?.website_scope,
    b?.confidence,
    b?.verification_notes,
    b?.logo_url,
    b?.founded_year,
    b?.about_summary,
    b?.about_page_link,
    b?.social_media?.twitter,
    b?.social_media?.linkedin,
    b?.social_media?.instagram,
    b?.social_media?.facebook,
    b?.social_media?.youtube,
    b?.social_media?.tiktok,
    b?.social_media?.pinterest,
    b?.contact_info?.email,
    b?.contact_info?.phone,
    b?.contact_info?.hq_address,
    b?.status,
  ])
  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map((v) => `"${(v || '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'brand_intelligence.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const SAMPLE_BRANDS: Brand[] = [
  {
    brand_name: 'Adidas',
    website_url: 'https://www.adidas.com.tr',
    website_scope: 'Turkey',
    confidence: 'Verified',
    verification_notes: 'Official Turkey site confirmed via locale selector and footer legal entity.',
    logo_url: 'https://logo.clearbit.com/adidas.com',
    founded_year: '1949',
    about_summary:
      'Adidas AG is a German multinational corporation that designs and manufactures shoes, clothing, and accessories.',
    about_page_link: 'https://www.adidas.com.tr/hakkimizda',
    product_category: 'Sportswear, Footwear, Accessories',
    social_media: {
      twitter: 'https://twitter.com/adidas',
      linkedin: 'https://linkedin.com/company/adidas',
      instagram: 'https://instagram.com/adidas',
      facebook: 'https://facebook.com/adidas',
      youtube: 'https://youtube.com/adidas',
      tiktok: 'https://tiktok.com/@adidas',
      pinterest: 'Not Found',
    },
    contact_info: {
      email: 'service@adidas.com.tr',
      phone: '+90 212 XXX XXXX',
      hq_address: 'Herzogenaurach, Germany',
    },
    status: 'Complete',
  },
  {
    brand_name: 'Abdullah Kigilil',
    website_url: 'https://www.kigilil.com.tr',
    website_scope: 'Turkey',
    confidence: 'Verified',
    verification_notes:
      'Turkish brand. Official .com.tr domain confirmed with brand logo and Turkish commerce info in footer.',
    logo_url: 'Not Found',
    founded_year: '1938',
    about_summary:
      'Kigilil is one of Turkey\'s oldest and most established menswear brands, known for suits, shirts, and formal wear.',
    about_page_link: 'https://www.kigilil.com.tr/kurumsal',
    product_category: 'Menswear, Formal Wear, Accessories',
    social_media: {
      twitter: 'Not Found',
      linkedin: 'https://linkedin.com/company/kigilil',
      instagram: 'https://instagram.com/kigilil',
      facebook: 'https://facebook.com/kigilil',
      youtube: 'Not Found',
      tiktok: 'Not Found',
      pinterest: 'Not Found',
    },
    contact_info: {
      email: 'info@kigilil.com.tr',
      phone: '+90 212 XXX XXXX',
      hq_address: 'Istanbul, Turkey',
    },
    status: 'Partial',
  },
  {
    brand_name: 'adL',
    website_url: 'https://www.adl.com.tr',
    website_scope: 'Turkey',
    confidence: 'Verified',
    verification_notes:
      'Turkish fashion brand. Official .com.tr domain with brand identity and Turkish e-commerce.',
    logo_url: 'https://logo.clearbit.com/adl.com.tr',
    founded_year: '1990',
    about_summary:
      'adL is a leading Turkish women\'s fashion brand offering contemporary clothing, accessories, and lifestyle products.',
    about_page_link: 'https://www.adl.com.tr/hakkimizda',
    product_category: 'Women\'s Fashion, Accessories',
    social_media: {
      twitter: 'Not Found',
      linkedin: 'Not Found',
      instagram: 'https://instagram.com/adl',
      facebook: 'https://facebook.com/adl',
      youtube: 'https://youtube.com/adl',
      tiktok: 'https://tiktok.com/@adl',
      pinterest: 'Not Found',
    },
    contact_info: {
      email: 'info@adl.com.tr',
      phone: '0850 XXX XXXX',
      hq_address: 'Istanbul, Turkey',
    },
    status: 'Partial',
  },
]

// ─── Glassmorphic Card component ──────────────────────────────────────────────

function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`backdrop-blur-[16px] bg-white/75 border border-white/[0.18] rounded-[0.875rem] shadow-lg ${className}`}
    >
      {children}
    </div>
  )
}

// ─── Social Link Icon ──────────────────────────────────────────────────────────

function SocialLink({
  url,
  icon,
  label,
}: {
  url: string
  icon: React.ReactNode
  label: string
}) {
  if (isNotFound(url)) {
    return (
      <span
        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground opacity-40 cursor-not-allowed"
        title={`${label}: Not Found`}
      >
        {icon}
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200"
      title={label}
    >
      {icon}
    </a>
  )
}

// ─── Contact Item ──────────────────────────────────────────────────────────────

function ContactItem({
  value,
  icon,
  label,
}: {
  value: string
  icon: React.ReactNode
  label: string
}) {
  const notAvailable = isNotFound(value)
  return (
    <div className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 flex-shrink-0 ${notAvailable ? 'text-muted-foreground opacity-40' : 'text-primary'}`}
      >
        {icon}
      </span>
      <div>
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <p
          className={
            notAvailable
              ? 'text-muted-foreground italic text-xs'
              : 'text-foreground text-sm break-all'
          }
        >
          {notAvailable ? 'Not Found' : value}
        </p>
      </div>
    </div>
  )
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isComplete = status?.toLowerCase() === 'complete'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
    >
      {isComplete ? <FiCheck className="w-3 h-3" /> : <FiAlertCircle className="w-3 h-3" />}
      {isComplete ? 'Complete' : 'Partial'}
    </span>
  )
}

// ─── Confidence Badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const level = confidence?.toLowerCase() ?? ''
  let classes = 'bg-gray-100 text-gray-600'
  if (level === 'verified') classes = 'bg-emerald-100 text-emerald-700'
  else if (level === 'partially verified') classes = 'bg-amber-100 text-amber-700'
  else if (level === 'not found') classes = 'bg-red-100 text-red-600'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}
    >
      <FiShield className="w-3 h-3" />
      {confidence || 'Unknown'}
    </span>
  )
}

// ─── Scope Badge ───────────────────────────────────────────────────────────────

function ScopeBadge({ scope }: { scope: string }) {
  const s = scope?.toLowerCase() ?? ''
  let classes = 'bg-gray-100 text-gray-600'
  if (s === 'turkey') classes = 'bg-red-50 text-red-700 border border-red-200'
  else if (s === 'global') classes = 'bg-blue-50 text-blue-700 border border-blue-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      <FaGlobe className="w-3 h-3" />
      {scope || 'N/A'}
    </span>
  )
}

// ─── Brand Row ─────────────────────────────────────────────────────────────────

function BrandRow({
  brand,
  expanded,
  onToggle,
}: {
  brand: Brand
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {!isNotFound(brand?.logo_url) ? (
              <img
                src={brand.logo_url}
                alt={brand?.brand_name ?? ''}
                className="w-8 h-8 rounded-lg object-contain bg-white border border-border/30"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-xs font-semibold">
                {(brand?.brand_name ?? '?')[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <span className="font-semibold text-foreground tracking-tight block">
                {brand?.brand_name ?? 'Unknown'}
              </span>
              {brand?.website_scope && (
                <ScopeBadge scope={brand.website_scope} />
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          {!isNotFound(brand?.product_category) ? (
            <span className="text-xs font-medium text-secondary-foreground bg-secondary px-2 py-1 rounded-md line-clamp-2">
              {brand.product_category}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs italic">N/A</span>
          )}
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          {!isNotFound(brand?.website_url) ? (
            <a
              href={brand.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <FaGlobe className="w-3 h-3 flex-shrink-0" />
              <span className="truncate max-w-[180px]">
                {brand.website_url.replace(/^https?:\/\/(www\.)?/, '')}
              </span>
            </a>
          ) : (
            <span className="text-muted-foreground text-xs italic">Not Found</span>
          )}
        </td>
        <td className="px-4 py-3 hidden lg:table-cell text-sm text-foreground">
          {!isNotFound(brand?.founded_year) ? (
            brand.founded_year
          ) : (
            <span className="text-muted-foreground italic text-xs">N/A</span>
          )}
        </td>
        <td className="px-4 py-3 hidden xl:table-cell">
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <SocialLink
              url={brand?.social_media?.instagram ?? ''}
              icon={<FaInstagram className="w-3.5 h-3.5" />}
              label="Instagram"
            />
            <SocialLink
              url={brand?.social_media?.twitter ?? ''}
              icon={<FaTwitter className="w-3.5 h-3.5" />}
              label="Twitter"
            />
            <SocialLink
              url={brand?.social_media?.linkedin ?? ''}
              icon={<FaLinkedin className="w-3.5 h-3.5" />}
              label="LinkedIn"
            />
            <SocialLink
              url={brand?.social_media?.facebook ?? ''}
              icon={<FaFacebook className="w-3.5 h-3.5" />}
              label="Facebook"
            />
          </div>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <ConfidenceBadge confidence={brand?.confidence ?? ''} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={brand?.status ?? 'Partial'} />
        </td>
        <td className="px-4 py-3 text-right">
          <button className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-secondary transition-colors">
            {expanded ? (
              <FiChevronUp className="w-4 h-4" />
            ) : (
              <FiChevronDown className="w-4 h-4" />
            )}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-secondary/20">
          <td colSpan={8} className="px-4 py-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* About & Verification */}
              <div className="md:col-span-2 space-y-4">
                {/* Verification Info */}
                {!isNotFound(brand?.verification_notes) && (
                  <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/50">
                    <div className="flex items-start gap-2">
                      <FiShield className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                          Verification
                        </span>
                        <p className="text-xs text-emerald-800 mt-0.5 leading-relaxed">
                          {brand.verification_notes}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* About */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground tracking-tight mb-1">About</h4>
                  <p
                    className={`text-sm leading-relaxed ${isNotFound(brand?.about_summary) ? 'text-muted-foreground italic' : 'text-foreground/80'}`}
                  >
                    {isNotFound(brand?.about_summary) ? 'No description available.' : brand.about_summary}
                  </p>
                  {!isNotFound(brand?.about_page_link) && (
                    <a
                      href={brand.about_page_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
                    >
                      <FiExternalLink className="w-3 h-3" /> About Page
                    </a>
                  )}
                </div>

                <Separator className="my-2" />

                {/* Social Media - Full */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground tracking-tight mb-2">
                    Social Media
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <SocialLink
                      url={brand?.social_media?.instagram ?? ''}
                      icon={<FaInstagram className="w-4 h-4" />}
                      label="Instagram"
                    />
                    <SocialLink
                      url={brand?.social_media?.twitter ?? ''}
                      icon={<FaTwitter className="w-4 h-4" />}
                      label="Twitter / X"
                    />
                    <SocialLink
                      url={brand?.social_media?.linkedin ?? ''}
                      icon={<FaLinkedin className="w-4 h-4" />}
                      label="LinkedIn"
                    />
                    <SocialLink
                      url={brand?.social_media?.facebook ?? ''}
                      icon={<FaFacebook className="w-4 h-4" />}
                      label="Facebook"
                    />
                    <SocialLink
                      url={brand?.social_media?.youtube ?? ''}
                      icon={<FaYoutube className="w-4 h-4" />}
                      label="YouTube"
                    />
                    <SocialLink
                      url={brand?.social_media?.tiktok ?? ''}
                      icon={<FaTiktok className="w-4 h-4" />}
                      label="TikTok"
                    />
                    <SocialLink
                      url={brand?.social_media?.pinterest ?? ''}
                      icon={<FaPinterest className="w-4 h-4" />}
                      label="Pinterest"
                    />
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-foreground tracking-tight">
                  Contact Information
                </h4>
                <div className="space-y-3">
                  <ContactItem
                    value={brand?.contact_info?.email ?? ''}
                    icon={<FaEnvelope className="w-3.5 h-3.5" />}
                    label="Email"
                  />
                  <ContactItem
                    value={brand?.contact_info?.phone ?? ''}
                    icon={<FaPhone className="w-3.5 h-3.5" />}
                    label="Phone"
                  />
                  <ContactItem
                    value={brand?.contact_info?.hq_address ?? ''}
                    icon={<FaMapMarkerAlt className="w-3.5 h-3.5" />}
                    label="HQ Address"
                  />
                </div>
                {!isNotFound(brand?.website_url) && (
                  <a
                    href={brand.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-sm text-primary hover:underline font-medium"
                  >
                    <FiExternalLink className="w-3.5 h-3.5" />
                    Visit Official Website
                  </a>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Agent Status ──────────────────────────────────────────────────────────────

function AgentStatus({ active }: { active: boolean }) {
  return (
    <GlassCard className="p-4 mt-6">
      <div className="flex items-center gap-3">
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground tracking-tight">{AGENT_NAME}</p>
          <p className="text-xs text-muted-foreground">
            Perplexity sonar-pro | Turkey-first research | {active ? 'Processing...' : 'Ready'}
          </p>
        </div>
      </div>
    </GlassCard>
  )
}

// ─── ErrorBoundary ─────────────────────────────────────────────────────────────

class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const [brandText, setBrandText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [brandNames, setBrandNames] = useState<string[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [currentBrand, setCurrentBrand] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('brand_name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [view, setView] = useState<ViewState>('input')
  const [error, setError] = useState<string | null>(null)
  const [artifactFiles, setArtifactFiles] = useState<
    Array<{ file_url: string; name?: string; format_type?: string }>
  >([])
  const [isDragging, setIsDragging] = useState(false)
  const [activeAgent, setActiveAgent] = useState(false)
  const [meta, setMeta] = useState({ total: 0, complete: 0, partial: 0 })
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [showSample, setShowSample] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Parse text input whenever it changes
  useEffect(() => {
    if (inputMode === 'text' && brandText.trim()) {
      const names = parseBrandText(brandText)
      setBrandNames(names)
    } else if (inputMode === 'text') {
      setBrandNames([])
    }
  }, [brandText, inputMode])

  // Progress simulation
  useEffect(() => {
    if (loading && brandNames.length > 0) {
      let current = 0
      const interval = setInterval(() => {
        current = Math.min(current + 1, brandNames.length)
        setCurrentBrand(current)
        if (current >= brandNames.length) clearInterval(interval)
      }, 2500)
      return () => clearInterval(interval)
    }
  }, [loading, brandNames.length])

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a .csv file')
      return
    }
    setError(null)
    setFile(selectedFile)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (text) {
        const names = parseBrandText(text)
        setBrandNames(names)
        setBrandText(names.join('\n'))
      }
    }
    reader.readAsText(selectedFile)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile) handleFileSelect(droppedFile)
    },
    [handleFileSelect]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) handleFileSelect(selected)
    },
    [handleFileSelect]
  )

  const clearInput = useCallback(() => {
    setFile(null)
    setBrandNames([])
    setBrandText('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleCollect = async () => {
    if (brandNames.length === 0) return
    setLoading(true)
    setError(null)
    setCurrentBrand(0)
    setActiveAgent(true)

    try {
      // Build the research message with Turkey-first methodology
      const brandList = brandNames.join('\n')
      const message = `You are an expert web researcher and verifier. Research the following brands with a Turkey-first methodology. For each brand, find the official website (prefer Turkey .com.tr or tr. subdomain, fallback to global), then extract details ONLY from the verified official site.

For each brand find:
- Official website URL (Turkey-first, then global)
- Website scope (Turkey / Global / Not Found)
- Verification confidence (Verified / Partially Verified / Not Found)
- Brief verification notes
- Logo URL (direct image file URL from site header)
- Founded year (only if stated on official site)
- About us summary (2-3 sentences)
- About page link
- Product categories (from site navigation)
- Social media: Instagram, Facebook, LinkedIn, Twitter/X, YouTube, TikTok, Pinterest
- Contact: email, phone, HQ address

Authenticity verification rules:
- Brand name/logo must match in header/footer
- REJECT marketplaces (Trendyol, Hepsiburada, Amazon), multi-brand retailers, resellers, coupon sites
- Use "Not Found" for any field not confirmed on the official site

Here are the brands:

${brandList}`

      const result = await callAIAgent(message, AGENT_ID)

      // Debug: log the full response structure to help diagnose parsing
      console.log('[BrandScope] Agent result success:', result.success)
      console.log('[BrandScope] response.result type:', typeof result?.response?.result)
      console.log('[BrandScope] response.result keys:', result?.response?.result && typeof result.response.result === 'object' ? Object.keys(result.response.result) : 'N/A')
      console.log('[BrandScope] response.result preview:', JSON.stringify(result?.response?.result)?.slice(0, 500))

      if (result.success) {
        const parsedBrands = parseAgentResponse(result)
        const parsedMeta = parseResponseMeta(result)

        console.log('[BrandScope] Parsed brands count:', parsedBrands.length)
        if (parsedBrands.length > 0) {
          console.log('[BrandScope] First brand:', JSON.stringify(parsedBrands[0]).slice(0, 300))
        }

        if (parsedBrands.length === 0) {
          // Build a diagnostic message
          const resultType = typeof result?.response?.result
          const resultKeys = result?.response?.result && typeof result.response.result === 'object'
            ? Object.keys(result.response.result as Record<string, unknown>).join(', ')
            : resultType
          console.error('[BrandScope] Parse failed. result type:', resultType, 'keys:', resultKeys)
          console.error('[BrandScope] Full response.result:', JSON.stringify(result?.response?.result)?.slice(0, 1000))

          setError(
            `Could not parse brand data from the agent response. Response type: ${resultType}, keys: [${resultKeys}]. Check browser console for details. Please try again.`
          )
          setLoading(false)
          setActiveAgent(false)
          return
        }

        setBrands(parsedBrands)
        setMeta({
          total: parsedMeta.total > 0 ? parsedMeta.total : parsedBrands.length,
          complete:
            parsedMeta.complete > 0
              ? parsedMeta.complete
              : parsedBrands.filter((b) => b?.status?.toLowerCase() === 'complete').length,
          partial:
            parsedMeta.partial > 0
              ? parsedMeta.partial
              : parsedBrands.filter((b) => b?.status?.toLowerCase() !== 'complete').length,
        })

        // Check module outputs for artifact files
        if (
          result.module_outputs?.artifact_files &&
          Array.isArray(result.module_outputs.artifact_files)
        ) {
          setArtifactFiles(result.module_outputs.artifact_files)
        }

        setView('results')
      } else {
        setError(
          result?.error ??
            result?.response?.message ??
            'An error occurred while processing your request. Please try again.'
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
      setActiveAgent(false)
    }
  }

  const handleNewSearch = () => {
    setView('input')
    setFile(null)
    setBrandNames([])
    setBrandText('')
    setBrands([])
    setArtifactFiles([])
    setError(null)
    setCurrentBrand(0)
    setExpandedRows(new Set())
    setSearchQuery('')
    setMeta({ total: 0, complete: 0, partial: 0 })
  }

  const toggleRow = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Filter and sort brands
  const getFilteredBrands = (): Brand[] => {
    const source = showSample && view === 'input' ? SAMPLE_BRANDS : brands
    let filtered = source.filter((b) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        (b?.brand_name ?? '').toLowerCase().includes(q) ||
        (b?.product_category ?? '').toLowerCase().includes(q) ||
        (b?.website_url ?? '').toLowerCase().includes(q) ||
        (b?.website_scope ?? '').toLowerCase().includes(q) ||
        (b?.confidence ?? '').toLowerCase().includes(q)
      )
    })

    filtered.sort((a, b) => {
      const aVal = (a?.[sortField] ?? '').toString().toLowerCase()
      const bVal = (b?.[sortField] ?? '').toString().toLowerCase()
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }

  const filteredBrands = getFilteredBrands()

  const SortHeader = ({ field, label, hiddenClass = '' }: { field: SortField; label: string; hiddenClass?: string }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors ${hiddenClass}`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field &&
          (sortDirection === 'asc' ? (
            <FiChevronUp className="w-3 h-3" />
          ) : (
            <FiChevronDown className="w-3 h-3" />
          ))}
      </span>
    </th>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageErrorBoundary>
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* ─── Header ────────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                BrandScope
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Brand Intelligence Collector -- Turkey-First Research
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {view === 'results' && (
                <>
                  {artifactFiles.length > 0 && (
                    <a
                      href={artifactFiles[0]?.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-md"
                    >
                      <FiDownload className="w-4 h-4" />
                      Download File
                    </a>
                  )}
                  <button
                    onClick={() => exportCSV(brands)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors shadow-sm"
                  >
                    <FiDownload className="w-4 h-4" />
                    Export CSV
                  </button>
                  <button
                    onClick={handleNewSearch}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-white/60 border border-border text-foreground text-sm font-medium hover:bg-white/80 transition-colors"
                  >
                    <FiEdit3 className="w-4 h-4" />
                    New Search
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ─── Error Banner ──────────────────────────────────────────────── */}
          {error && (
            <GlassCard className="p-4 mb-6 border-destructive/30 bg-destructive/5">
              <div className="flex items-start gap-3">
                <FiAlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/80 mt-0.5">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto flex-shrink-0 p-1 hover:bg-destructive/10 rounded-lg transition-colors"
                >
                  <FiX className="w-4 h-4 text-destructive" />
                </button>
              </div>
            </GlassCard>
          )}

          {/* ─── Input State ───────────────────────────────────────────────── */}
          {view === 'input' && !loading && (
            <div className="space-y-6">
              {/* Input Mode Tabs */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInputMode('text')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] text-sm font-medium transition-all ${inputMode === 'text' ? 'bg-primary text-primary-foreground shadow-md' : 'bg-secondary/60 text-secondary-foreground hover:bg-secondary'}`}
                >
                  <FiEdit3 className="w-4 h-4" />
                  Paste Brand Names
                </button>
                <button
                  onClick={() => setInputMode('csv')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] text-sm font-medium transition-all ${inputMode === 'csv' ? 'bg-primary text-primary-foreground shadow-md' : 'bg-secondary/60 text-secondary-foreground hover:bg-secondary'}`}
                >
                  <FiUpload className="w-4 h-4" />
                  Upload CSV
                </button>
              </div>

              {/* Text Paste Input */}
              {inputMode === 'text' && (
                <GlassCard className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-foreground tracking-tight">
                          Enter Brand Names
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          One brand per line, or comma-separated
                        </p>
                      </div>
                      {brandNames.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {brandNames.length} brand{brandNames.length !== 1 ? 's' : ''} detected
                          </Badge>
                          <button
                            onClick={clearInput}
                            className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors text-muted-foreground hover:text-destructive"
                          >
                            <FiX className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={brandText}
                      onChange={(e) => setBrandText(e.target.value)}
                      placeholder={`Abdullah Kigilil\nAbercrombie & Fitch\nAce Nayman\nAdidas\nadL`}
                      rows={8}
                      className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-y font-mono leading-relaxed"
                    />

                    {/* Brand preview chips */}
                    {brandNames.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-1">
                          {brandNames.map((name, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <Separator />

                    <button
                      onClick={handleCollect}
                      disabled={brandNames.length === 0}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-[0.875rem] bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
                    >
                      <FiSearch className="w-4 h-4" />
                      Collect Brand Info ({brandNames.length} brand{brandNames.length !== 1 ? 's' : ''})
                    </button>
                  </div>
                </GlassCard>
              )}

              {/* CSV Upload */}
              {inputMode === 'csv' && (
                <>
                  <GlassCard className="p-0">
                    <div
                      className={`relative flex flex-col items-center justify-center py-14 px-8 border-2 border-dashed rounded-[0.875rem] cursor-pointer transition-all duration-200 ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-primary/[0.02]'}`}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleInputChange}
                      />
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-colors ${isDragging ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}
                      >
                        <FiUpload className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold text-foreground tracking-tight mb-1">
                        {isDragging ? 'Drop your CSV here' : 'Drag CSV or click to upload'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        .csv files only -- one brand name per row
                      </p>
                    </div>
                  </GlassCard>

                  {/* File Preview */}
                  {file && brandNames.length > 0 && (
                    <GlassCard className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <FiFile className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground tracking-tight">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {brandNames.length} brand{brandNames.length !== 1 ? 's' : ''} detected
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={clearInput}
                          className="p-2 hover:bg-destructive/10 rounded-lg transition-colors text-muted-foreground hover:text-destructive"
                        >
                          <FiX className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {brandNames.map((name, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <Separator className="my-5" />
                      <button
                        onClick={handleCollect}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-[0.875rem] bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-md hover:shadow-lg"
                      >
                        <FiSearch className="w-4 h-4" />
                        Collect Brand Info
                      </button>
                    </GlassCard>
                  )}
                </>
              )}

              {/* Info card */}
              <GlassCard className="p-5">
                <div className="flex items-start gap-3">
                  <FiInfo className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">How it works</p>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside leading-relaxed">
                      <li>Paste brand names (or upload a CSV) -- one brand per line or comma-separated</li>
                      <li>BrandScope searches for each brand's official website (Turkey-local first, then global)</li>
                      <li>Verifies authenticity by checking brand identity, legal info, and social cross-references</li>
                      <li>Extracts details from the verified official site: categories, logo, contact, social links</li>
                      <li>Results displayed in a table with confidence levels -- export as CSV anytime</li>
                    </ol>
                    <button
                      onClick={() => setShowSample(!showSample)}
                      className="text-xs text-primary font-medium hover:underline mt-1 inline-flex items-center gap-1"
                    >
                      <FiList className="w-3 h-3" />
                      {showSample ? 'Hide sample preview' : 'View sample results'}
                    </button>
                  </div>
                </div>
              </GlassCard>

              {/* Sample data preview */}
              {showSample && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground tracking-tight">
                      Sample Results Preview
                    </h2>
                    <Badge variant="secondary" className="text-xs">
                      {SAMPLE_BRANDS.length} brands
                    </Badge>
                  </div>
                  <GlassCard className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-secondary/40 border-b border-border/50">
                          <tr>
                            <SortHeader field="brand_name" label="Brand" />
                            <SortHeader field="product_category" label="Category" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                              Website
                            </th>
                            <SortHeader field="founded_year" label="Founded" hiddenClass="hidden lg:table-cell" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                              Social
                            </th>
                            <SortHeader field="confidence" label="Confidence" hiddenClass="hidden lg:table-cell" />
                            <SortHeader field="status" label="Status" />
                            <th className="px-4 py-3 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBrands.map((brand, idx) => (
                            <BrandRow
                              key={`sample-${idx}`}
                              brand={brand}
                              expanded={expandedRows.has(idx)}
                              onToggle={() => toggleRow(idx)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </GlassCard>
                </div>
              )}
            </div>
          )}

          {/* ─── Processing State ──────────────────────────────────────────── */}
          {loading && (
            <div className="space-y-6">
              <GlassCard className="p-8">
                <div className="max-w-md mx-auto text-center space-y-5">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                    <FiSearch className="w-6 h-6 text-primary animate-pulse" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-foreground tracking-tight mb-1">
                      Researching brand {Math.min(currentBrand + 1, brandNames.length)} of{' '}
                      {brandNames.length}...
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentBrand < brandNames.length
                        ? brandNames[currentBrand]
                        : 'Finalizing results...'}
                    </p>
                  </div>
                  <Progress
                    value={
                      brandNames.length > 0 ? (currentBrand / brandNames.length) * 100 : 0
                    }
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    {Math.round(
                      brandNames.length > 0 ? (currentBrand / brandNames.length) * 100 : 0
                    )}
                    % complete
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Turkey-first website verification in progress...
                  </p>
                </div>
              </GlassCard>

              {/* Skeletons */}
              <GlassCard className="p-6 space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3 rounded-lg" />
                      <Skeleton className="h-3 w-2/3 rounded-lg" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </GlassCard>
            </div>
          )}

          {/* ─── Results State ─────────────────────────────────────────────── */}
          {view === 'results' && !loading && (
            <div className="space-y-6">
              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <GlassCard className="p-5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                    Total Brands
                  </p>
                  <p className="text-2xl font-semibold text-foreground tracking-tight">
                    {meta.total > 0 ? meta.total : brands.length}
                  </p>
                </GlassCard>
                <GlassCard className="p-5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                    Verified / Complete
                  </p>
                  <p className="text-2xl font-semibold text-emerald-600 tracking-tight">
                    {meta.complete > 0
                      ? meta.complete
                      : brands.filter(
                          (b) =>
                            b?.status?.toLowerCase() === 'complete' ||
                            b?.confidence?.toLowerCase() === 'verified'
                        ).length}
                  </p>
                </GlassCard>
                <GlassCard className="p-5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                    Partial / Not Found
                  </p>
                  <p className="text-2xl font-semibold text-amber-600 tracking-tight">
                    {meta.partial > 0
                      ? meta.partial
                      : brands.filter(
                          (b) =>
                            b?.status?.toLowerCase() !== 'complete' &&
                            b?.confidence?.toLowerCase() !== 'verified'
                        ).length}
                  </p>
                </GlassCard>
              </div>

              {/* Search Toolbar */}
              <GlassCard className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search by name, category, website, scope, or confidence..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    />
                  </div>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {filteredBrands.length} result{filteredBrands.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </GlassCard>

              {/* Results Table */}
              <GlassCard className="overflow-hidden">
                {filteredBrands.length > 0 ? (
                  <ScrollArea className="max-h-[650px]">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-secondary/40 border-b border-border/50 sticky top-0 z-10">
                          <tr>
                            <SortHeader field="brand_name" label="Brand" />
                            <SortHeader field="product_category" label="Category" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                              Website
                            </th>
                            <SortHeader field="founded_year" label="Founded" hiddenClass="hidden lg:table-cell" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                              Social
                            </th>
                            <SortHeader field="confidence" label="Confidence" hiddenClass="hidden lg:table-cell" />
                            <SortHeader field="status" label="Status" />
                            <th className="px-4 py-3 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBrands.map((brand, idx) => (
                            <BrandRow
                              key={`result-${idx}`}
                              brand={brand}
                              expanded={expandedRows.has(idx)}
                              onToggle={() => toggleRow(idx)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FiSearch className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No brands match your search
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Try a different search term
                    </p>
                  </div>
                )}
              </GlassCard>

              {/* Download Artifact Files */}
              {artifactFiles.length > 0 && (
                <GlassCard className="p-5">
                  <h3 className="text-sm font-semibold text-foreground tracking-tight mb-3">
                    Downloadable Files
                  </h3>
                  <div className="space-y-2">
                    {artifactFiles.map((af, i) => (
                      <a
                        key={i}
                        href={af?.file_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 hover:bg-secondary/70 transition-colors group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <FiFile className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {af?.name ?? `File ${i + 1}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {af?.format_type ?? 'Download'}
                          </p>
                        </div>
                        <FiDownload className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </a>
                    ))}
                  </div>
                </GlassCard>
              )}
            </div>
          )}

          {/* ─── Agent Status ──────────────────────────────────────────────── */}
          <AgentStatus active={activeAgent} />
        </div>
      </div>
    </PageErrorBoundary>
  )
}
