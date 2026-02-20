'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { callAIAgent, uploadFiles } from '@/lib/aiAgent'
import type { AIAgentResponse } from '@/lib/aiAgent'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
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
}

interface ContactInfo {
  email: string
  phone: string
  hq_address: string
}

interface Brand {
  brand_name: string
  website_url: string
  logo_url: string
  founded_year: string
  about_summary: string
  product_category: string
  social_media: SocialMedia
  contact_info: ContactInfo
  status: string
}

interface AgentResponseData {
  brands: Brand[]
  total_brands: number
  complete_count: number
  partial_count: number
}

type SortField = 'brand_name' | 'product_category' | 'website_url' | 'founded_year' | 'status'
type SortDirection = 'asc' | 'desc'
type ViewState = 'upload' | 'results'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isNotFound = (val: string | undefined | null): boolean => {
  if (!val) return true
  return val.trim().toLowerCase() === 'not found' || val.trim() === ''
}

const parseCSV = (text: string): string[] => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase().replace(/['"]/g, '')
    return lower !== 'brand' && lower !== 'name' && lower !== 'brand_name' && lower !== 'brand name' && lower !== 'company' && lower !== 'company name'
  })
  return filtered.map((l) => l.replace(/^["']|["']$/g, '').trim()).filter((l) => l.length > 0)
}

const parseAgentResponse = (result: AIAgentResponse): Brand[] => {
  try {
    let data = result?.response?.result as unknown
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return []
      }
    }
    const obj = data as Record<string, unknown> | undefined
    const brands = obj?.brands
    if (Array.isArray(brands)) {
      return brands as Brand[]
    }
    if (Array.isArray(data)) {
      return data as Brand[]
    }
    return []
  } catch {
    return []
  }
}

const parseResponseMeta = (result: AIAgentResponse): { total: number; complete: number; partial: number } => {
  try {
    let data = result?.response?.result as unknown
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch { return { total: 0, complete: 0, partial: 0 } }
    }
    const obj = data as Record<string, unknown> | undefined
    return {
      total: typeof obj?.total_brands === 'number' ? obj.total_brands : 0,
      complete: typeof obj?.complete_count === 'number' ? obj.complete_count : 0,
      partial: typeof obj?.partial_count === 'number' ? obj.partial_count : 0,
    }
  } catch {
    return { total: 0, complete: 0, partial: 0 }
  }
}

const exportCSV = (brands: Brand[]) => {
  const headers = ['Brand Name', 'Category', 'Website', 'Logo URL', 'Founded Year', 'About', 'Twitter', 'LinkedIn', 'Instagram', 'Facebook', 'Email', 'Phone', 'HQ Address', 'Status']
  const rows = brands.map((b) => [
    b?.brand_name, b?.product_category, b?.website_url, b?.logo_url, b?.founded_year,
    b?.about_summary, b?.social_media?.twitter, b?.social_media?.linkedin,
    b?.social_media?.instagram, b?.social_media?.facebook,
    b?.contact_info?.email, b?.contact_info?.phone, b?.contact_info?.hq_address, b?.status,
  ])
  const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${(v || '').replace(/"/g, '""')}"`).join(','))].join('\n')
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
    brand_name: 'Nike',
    website_url: 'https://www.nike.com',
    logo_url: 'https://logo.clearbit.com/nike.com',
    founded_year: '1964',
    about_summary: 'Nike, Inc. is an American multinational corporation engaged in the design, development, manufacturing, and marketing of footwear, apparel, equipment, accessories, and services worldwide.',
    product_category: 'Sportswear',
    social_media: { twitter: 'https://twitter.com/Nike', linkedin: 'https://linkedin.com/company/nike', instagram: 'https://instagram.com/nike', facebook: 'https://facebook.com/nike' },
    contact_info: { email: 'consumer.services@nike.com', phone: '1-800-344-6453', hq_address: 'One Bowerman Drive, Beaverton, OR 97005, USA' },
    status: 'Complete',
  },
  {
    brand_name: 'Apple',
    website_url: 'https://www.apple.com',
    logo_url: 'https://logo.clearbit.com/apple.com',
    founded_year: '1976',
    about_summary: 'Apple Inc. is an American multinational technology company that designs, develops, and sells consumer electronics, computer software, and online services.',
    product_category: 'Consumer Tech',
    social_media: { twitter: 'https://twitter.com/Apple', linkedin: 'https://linkedin.com/company/apple', instagram: 'https://instagram.com/apple', facebook: 'Not Found' },
    contact_info: { email: 'Not Found', phone: '1-800-275-2273', hq_address: 'One Apple Park Way, Cupertino, CA 95014, USA' },
    status: 'Partial',
  },
  {
    brand_name: 'Tesla',
    website_url: 'https://www.tesla.com',
    logo_url: 'https://logo.clearbit.com/tesla.com',
    founded_year: '2003',
    about_summary: 'Tesla, Inc. is an American electric vehicle and clean energy company. Tesla designs and manufactures electric cars, battery energy storage, and solar panels.',
    product_category: 'Automotive / Clean Energy',
    social_media: { twitter: 'https://twitter.com/Tesla', linkedin: 'https://linkedin.com/company/tesla-motors', instagram: 'https://instagram.com/teslamotors', facebook: 'https://facebook.com/tesla' },
    contact_info: { email: 'press@tesla.com', phone: '1-888-518-3752', hq_address: '1 Tesla Road, Austin, TX 78725, USA' },
    status: 'Complete',
  },
  {
    brand_name: 'Spotify',
    website_url: 'https://www.spotify.com',
    logo_url: 'https://logo.clearbit.com/spotify.com',
    founded_year: '2006',
    about_summary: 'Spotify is a Swedish audio streaming and media services provider offering digital copyright restricted recorded audio content including songs, podcasts, and videos.',
    product_category: 'Music Streaming',
    social_media: { twitter: 'https://twitter.com/Spotify', linkedin: 'https://linkedin.com/company/spotify', instagram: 'https://instagram.com/spotify', facebook: 'https://facebook.com/spotify' },
    contact_info: { email: 'support@spotify.com', phone: 'Not Found', hq_address: 'Regeringsgatan 19, 111 53 Stockholm, Sweden' },
    status: 'Partial',
  },
]

// ─── Glassmorphic Card component ──────────────────────────────────────────────

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`backdrop-blur-[16px] bg-white/75 border border-white/[0.18] rounded-[0.875rem] shadow-lg ${className}`}>
      {children}
    </div>
  )
}

// ─── Social Link Icon ──────────────────────────────────────────────────────────

function SocialLink({ url, icon, label }: { url: string; icon: React.ReactNode; label: string }) {
  if (isNotFound(url)) {
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground opacity-40 cursor-not-allowed" title={`${label}: Not Found`}>
        {icon}
      </span>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200" title={label}>
      {icon}
    </a>
  )
}

// ─── Contact Item ──────────────────────────────────────────────────────────────

function ContactItem({ value, icon, label }: { value: string; icon: React.ReactNode; label: string }) {
  const notAvailable = isNotFound(value)
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 flex-shrink-0 ${notAvailable ? 'text-muted-foreground opacity-40' : 'text-primary'}`}>{icon}</span>
      <div>
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <p className={notAvailable ? 'text-muted-foreground italic text-xs' : 'text-foreground text-sm'}>{notAvailable ? 'Not Found' : value}</p>
      </div>
    </div>
  )
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isComplete = status?.toLowerCase() === 'complete'
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {isComplete ? <FiCheck className="w-3 h-3" /> : <FiAlertCircle className="w-3 h-3" />}
      {isComplete ? 'Complete' : 'Partial'}
    </span>
  )
}

// ─── Brand Row ─────────────────────────────────────────────────────────────────

function BrandRow({ brand, expanded, onToggle }: { brand: Brand; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {!isNotFound(brand?.logo_url) ? (
              <img src={brand.logo_url} alt={brand?.brand_name ?? ''} className="w-8 h-8 rounded-lg object-contain bg-white border border-border/30" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-xs font-semibold">
                {(brand?.brand_name ?? '?')[0]?.toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-foreground tracking-tight">{brand?.brand_name ?? 'Unknown'}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          {!isNotFound(brand?.product_category) ? (
            <Badge variant="secondary" className="text-xs font-medium">{brand.product_category}</Badge>
          ) : (
            <span className="text-muted-foreground text-xs italic">N/A</span>
          )}
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          {!isNotFound(brand?.website_url) ? (
            <a href={brand.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <FaGlobe className="w-3 h-3" />
              <span className="truncate max-w-[160px]">{brand.website_url.replace(/^https?:\/\/(www\.)?/, '')}</span>
            </a>
          ) : (
            <span className="text-muted-foreground text-xs italic">Not Found</span>
          )}
        </td>
        <td className="px-4 py-3 hidden lg:table-cell text-sm text-foreground">{!isNotFound(brand?.founded_year) ? brand.founded_year : <span className="text-muted-foreground italic text-xs">N/A</span>}</td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <SocialLink url={brand?.social_media?.twitter ?? ''} icon={<FaTwitter className="w-3.5 h-3.5" />} label="Twitter" />
            <SocialLink url={brand?.social_media?.linkedin ?? ''} icon={<FaLinkedin className="w-3.5 h-3.5" />} label="LinkedIn" />
            <SocialLink url={brand?.social_media?.instagram ?? ''} icon={<FaInstagram className="w-3.5 h-3.5" />} label="Instagram" />
            <SocialLink url={brand?.social_media?.facebook ?? ''} icon={<FaFacebook className="w-3.5 h-3.5" />} label="Facebook" />
          </div>
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={brand?.status ?? 'Partial'} />
        </td>
        <td className="px-4 py-3 text-right">
          <button className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-secondary transition-colors">
            {expanded ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-secondary/20">
          <td colSpan={7} className="px-4 py-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* About */}
              <div className="md:col-span-2 space-y-3">
                <h4 className="text-sm font-semibold text-foreground tracking-tight">About</h4>
                <p className={`text-sm leading-relaxed ${isNotFound(brand?.about_summary) ? 'text-muted-foreground italic' : 'text-foreground/80'}`}>
                  {isNotFound(brand?.about_summary) ? 'No description available.' : brand.about_summary}
                </p>
                <Separator className="my-3" />
                <h4 className="text-sm font-semibold text-foreground tracking-tight">Social Media</h4>
                <div className="flex items-center gap-2">
                  <SocialLink url={brand?.social_media?.twitter ?? ''} icon={<FaTwitter className="w-4 h-4" />} label="Twitter / X" />
                  <SocialLink url={brand?.social_media?.linkedin ?? ''} icon={<FaLinkedin className="w-4 h-4" />} label="LinkedIn" />
                  <SocialLink url={brand?.social_media?.instagram ?? ''} icon={<FaInstagram className="w-4 h-4" />} label="Instagram" />
                  <SocialLink url={brand?.social_media?.facebook ?? ''} icon={<FaFacebook className="w-4 h-4" />} label="Facebook" />
                </div>
              </div>
              {/* Contact Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground tracking-tight">Contact Information</h4>
                <div className="space-y-3">
                  <ContactItem value={brand?.contact_info?.email ?? ''} icon={<FaEnvelope className="w-3.5 h-3.5" />} label="Email" />
                  <ContactItem value={brand?.contact_info?.phone ?? ''} icon={<FaPhone className="w-3.5 h-3.5" />} label="Phone" />
                  <ContactItem value={brand?.contact_info?.hq_address ?? ''} icon={<FaMapMarkerAlt className="w-3.5 h-3.5" />} label="HQ Address" />
                </div>
                {!isNotFound(brand?.website_url) && (
                  <a href={brand.website_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-sm text-primary hover:underline font-medium">
                    <FiExternalLink className="w-3.5 h-3.5" />
                    Visit Website
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
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground tracking-tight">{AGENT_NAME}</p>
          <p className="text-xs text-muted-foreground">ID: {AGENT_ID.slice(0, 8)}... | {active ? 'Processing' : 'Idle'}</p>
        </div>
      </div>
    </GlassCard>
  )
}

// ─── ErrorBoundary ─────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
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
            <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
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
  const [file, setFile] = useState<File | null>(null)
  const [brandNames, setBrandNames] = useState<string[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [currentBrand, setCurrentBrand] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('brand_name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [view, setView] = useState<ViewState>('upload')
  const [error, setError] = useState<string | null>(null)
  const [artifactFiles, setArtifactFiles] = useState<Array<{ file_url: string; name?: string; format_type?: string }>>([])
  const [isDragging, setIsDragging] = useState(false)
  const [sampleData, setSampleData] = useState(false)
  const [activeAgent, setActiveAgent] = useState(false)
  const [meta, setMeta] = useState({ total: 0, complete: 0, partial: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Determine display brands: sample vs real
  const displayBrands = sampleData && view === 'upload' ? SAMPLE_BRANDS : brands

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
        const names = parseCSV(text)
        setBrandNames(names)
      }
    }
    reader.readAsText(selectedFile)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) handleFileSelect(droppedFile)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) handleFileSelect(selected)
  }, [handleFileSelect])

  const clearFile = useCallback(() => {
    setFile(null)
    setBrandNames([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleCollect = async () => {
    if (!file || brandNames.length === 0) return
    setLoading(true)
    setError(null)
    setCurrentBrand(0)
    setActiveAgent(true)

    try {
      // 1. Upload file
      const uploadResult = await uploadFiles(file)
      if (!uploadResult.success || !Array.isArray(uploadResult.asset_ids) || uploadResult.asset_ids.length === 0) {
        setError('Failed to upload file. Please try again.')
        setLoading(false)
        setActiveAgent(false)
        return
      }

      // 2. Call agent
      const message = `Research the following brands and collect comprehensive brand intelligence for each: ${brandNames.join(', ')}. For each brand, find: website URL, logo URL, founded year, about us summary (2-3 sentences), product category, social media links (Twitter/X, LinkedIn, Instagram, Facebook), and contact info (email, phone, HQ address). Mark any unavailable fields as 'Not Found'.`
      const result = await callAIAgent(message, AGENT_ID, { assets: uploadResult.asset_ids })

      if (result.success) {
        const parsedBrands = parseAgentResponse(result)
        const parsedMeta = parseResponseMeta(result)
        setBrands(parsedBrands)
        setMeta(parsedMeta)

        // Check module outputs for artifact files
        if (result.module_outputs?.artifact_files && Array.isArray(result.module_outputs.artifact_files)) {
          setArtifactFiles(result.module_outputs.artifact_files)
        }

        setView('results')
      } else {
        setError(result?.error ?? result?.response?.message ?? 'An error occurred while processing your request.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
      setActiveAgent(false)
    }
  }

  const handleNewUpload = () => {
    setView('upload')
    setFile(null)
    setBrandNames([])
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

  // Filter and sort brands for display
  const getFilteredBrands = (): Brand[] => {
    const source = view === 'results' ? brands : (sampleData ? SAMPLE_BRANDS : [])
    let filtered = source.filter((b) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        (b?.brand_name ?? '').toLowerCase().includes(q) ||
        (b?.product_category ?? '').toLowerCase().includes(q) ||
        (b?.website_url ?? '').toLowerCase().includes(q)
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

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && (sortDirection === 'asc' ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* ─── Header ────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">BrandScope</h1>
              <p className="text-sm text-muted-foreground mt-1">Brand Intelligence Collector</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="sample-toggle" className="text-xs text-muted-foreground font-medium">Sample Data</label>
                <Switch id="sample-toggle" checked={sampleData} onCheckedChange={setSampleData} />
              </div>
              {view === 'results' && (
                <div className="flex items-center gap-2">
                  {artifactFiles.length > 0 && (
                    <a href={artifactFiles[0]?.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-md">
                      <FiDownload className="w-4 h-4" />
                      Download File
                    </a>
                  )}
                  <button onClick={() => exportCSV(brands)} className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors shadow-sm">
                    <FiDownload className="w-4 h-4" />
                    Export CSV
                  </button>
                  <button onClick={handleNewUpload} className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.875rem] bg-white/60 border border-border text-foreground text-sm font-medium hover:bg-white/80 transition-colors">
                    <FiUpload className="w-4 h-4" />
                    New Upload
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ─── Error Banner ──────────────────────────────────────────────── */}
          {error && (
            <GlassCard className="p-4 mb-6 border-destructive/30 bg-destructive/5">
              <div className="flex items-start gap-3">
                <FiAlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/80 mt-0.5">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="ml-auto flex-shrink-0 p-1 hover:bg-destructive/10 rounded-lg transition-colors">
                  <FiX className="w-4 h-4 text-destructive" />
                </button>
              </div>
            </GlassCard>
          )}

          {/* ─── Upload State ──────────────────────────────────────────────── */}
          {view === 'upload' && !loading && (
            <div className="space-y-6">
              {/* Dropzone */}
              <GlassCard className="p-0">
                <div
                  className={`relative flex flex-col items-center justify-center py-16 px-8 border-2 border-dashed rounded-[0.875rem] cursor-pointer transition-all duration-200 ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-primary/[0.02]'}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors ${isDragging ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    <FiUpload className="w-6 h-6" />
                  </div>
                  <p className="text-base font-semibold text-foreground tracking-tight mb-1">
                    {isDragging ? 'Drop your CSV here' : 'Drag CSV or click to upload'}
                  </p>
                  <p className="text-sm text-muted-foreground">.csv files only - one brand name per row</p>
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
                        <p className="text-sm font-semibold text-foreground tracking-tight">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{brandNames.length} brand{brandNames.length !== 1 ? 's' : ''} detected</p>
                      </div>
                    </div>
                    <button onClick={clearFile} className="p-2 hover:bg-destructive/10 rounded-lg transition-colors text-muted-foreground hover:text-destructive">
                      <FiX className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {brandNames.map((name, i) => (
                      <span key={i} className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">{name}</span>
                    ))}
                  </div>
                  <Separator className="my-5" />
                  <button onClick={handleCollect} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-[0.875rem] bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-md hover:shadow-lg">
                    <FiSearch className="w-4 h-4" />
                    Collect Brand Info
                  </button>
                </GlassCard>
              )}

              {/* Empty state guide */}
              {!file && !sampleData && (
                <GlassCard className="p-6">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Upload a CSV file containing brand names (one per row) and BrandScope will research each brand to collect website URLs, logos, social media profiles, contact information, and more.
                    </p>
                  </div>
                </GlassCard>
              )}

              {/* Sample data preview */}
              {sampleData && !file && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground tracking-tight">Sample Results Preview</h2>
                    <Badge variant="secondary" className="text-xs">{SAMPLE_BRANDS.length} brands</Badge>
                  </div>
                  <GlassCard className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-secondary/40 border-b border-border/50">
                          <tr>
                            <SortHeader field="brand_name" label="Brand" />
                            <SortHeader field="product_category" label="Category" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Website</th>
                            <SortHeader field="founded_year" label="Founded" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Social</th>
                            <SortHeader field="status" label="Status" />
                            <th className="px-4 py-3 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBrands.map((brand, idx) => (
                            <BrandRow key={`sample-${idx}`} brand={brand} expanded={expandedRows.has(idx)} onToggle={() => toggleRow(idx)} />
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
                      Researching brand {Math.min(currentBrand + 1, brandNames.length)} of {brandNames.length}...
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentBrand < brandNames.length ? brandNames[currentBrand] : 'Finalizing results...'}
                    </p>
                  </div>
                  <Progress value={brandNames.length > 0 ? (currentBrand / brandNames.length) * 100 : 0} className="h-2" />
                  <p className="text-xs text-muted-foreground">{Math.round(brandNames.length > 0 ? (currentBrand / brandNames.length) * 100 : 0)}% complete</p>
                </div>
              </GlassCard>

              {/* Skeletons */}
              <GlassCard className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
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
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total Brands</p>
                  <p className="text-2xl font-semibold text-foreground tracking-tight">{meta.total > 0 ? meta.total : brands.length}</p>
                </GlassCard>
                <GlassCard className="p-5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Complete</p>
                  <p className="text-2xl font-semibold text-emerald-600 tracking-tight">{meta.complete > 0 ? meta.complete : brands.filter((b) => b?.status?.toLowerCase() === 'complete').length}</p>
                </GlassCard>
                <GlassCard className="p-5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Partial</p>
                  <p className="text-2xl font-semibold text-amber-600 tracking-tight">{meta.partial > 0 ? meta.partial : brands.filter((b) => b?.status?.toLowerCase() !== 'complete').length}</p>
                </GlassCard>
              </div>

              {/* Search Toolbar */}
              <GlassCard className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search brands by name, category, or website..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    />
                  </div>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">{filteredBrands.length} result{filteredBrands.length !== 1 ? 's' : ''}</Badge>
                </div>
              </GlassCard>

              {/* Results Table */}
              <GlassCard className="overflow-hidden">
                {filteredBrands.length > 0 ? (
                  <ScrollArea className="max-h-[600px]">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-secondary/40 border-b border-border/50 sticky top-0 z-10">
                          <tr>
                            <SortHeader field="brand_name" label="Brand" />
                            <SortHeader field="product_category" label="Category" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Website</th>
                            <SortHeader field="founded_year" label="Founded" />
                            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Social</th>
                            <SortHeader field="status" label="Status" />
                            <th className="px-4 py-3 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBrands.map((brand, idx) => (
                            <BrandRow key={`result-${idx}`} brand={brand} expanded={expandedRows.has(idx)} onToggle={() => toggleRow(idx)} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FiSearch className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No brands match your search</p>
                    <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
                  </div>
                )}
              </GlassCard>

              {/* Download Artifact Files */}
              {artifactFiles.length > 0 && (
                <GlassCard className="p-5">
                  <h3 className="text-sm font-semibold text-foreground tracking-tight mb-3">Downloadable Files</h3>
                  <div className="space-y-2">
                    {artifactFiles.map((af, i) => (
                      <a key={i} href={af?.file_url ?? '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 hover:bg-secondary/70 transition-colors group">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <FiFile className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{af?.name ?? `File ${i + 1}`}</p>
                          <p className="text-xs text-muted-foreground">{af?.format_type ?? 'Download'}</p>
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
    </ErrorBoundary>
  )
}
