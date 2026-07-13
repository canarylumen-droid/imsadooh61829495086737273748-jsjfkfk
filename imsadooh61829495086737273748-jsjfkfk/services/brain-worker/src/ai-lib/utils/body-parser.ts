import { generateReply } from "../core/ai-service.js";
import { MODELS } from "./model-config.js";

export interface ParsedEmailBody {
    name: string;
    email: string;
    phone?: string;
    company?: string;
    job_title?: string;
    intent: string;
    summary: string;
    urgency: 'low' | 'medium' | 'high';
    sentiment: 'positive' | 'neutral' | 'negative';
}

export interface ParsedLeadResult {
    leads: ParsedEmailBody[];
}

/**
 * Parses raw text (email body or pasted data) into structured JSON using AI.
 * Handles both single emails and bulk pasted data (names, numbers, CSV-like).
 */
export async function parseEmailBody(body: string): Promise<ParsedLeadResult> {
    const isLikelyBulk = body.includes('\n') && (
        body.includes(',') || 
        body.includes('\t') || 
        body.split('\n').length > 5
    );

    const prompt = isLikelyBulk ? `
    Parse the following data into structured lead information.
    This appears to be a bulk import (CSV, pasted list, or structured data).
    
    Extract ALL leads from the data. For each lead, extract as many fields as possible.
    
    Return ONLY a JSON object with a "leads" array. Each lead object can have:
    - name: Full name (required, use "Unknown" if missing)
    - email: Email address
    - phone: Phone number (include full number with country code if present)
    - company: Company or business name
    - job_title: Job title or role
    - website: Website URL
    - city: City
    - country: Country
    - niche: Industry or niche
    - review: Review text or rating
    - business_name: Business/store name
    - google_maps_url: Google Maps URL
    - intent: Brief description
    - summary: A 1-sentence summary
    - urgency: One of: low, medium, high
    - sentiment: One of: positive, neutral, negative
    
    Data:
    """
    ${body}
    """
    
    IMPORTANT: Return ALL leads found. If the data contains 50 leads, return all 50.
  ` : `
    Extract structured lead information from the following email body. 
    Return ONLY a JSON object with a "leads" array containing ONE lead object:
    - name: Full name of the sender (required)
    - email: Email address of the sender (if available)
    - phone: Phone number (if available)
    - company: Company name (if mentioned)
    - job_title: Job title (if mentioned)
    - website: Website URL (if mentioned)
    - city: City (if mentioned)
    - country: Country (if mentioned)
    - niche: Industry or niche (if mentioned)
    - intent: Brief description of why they are reaching out
    - summary: A 1-sentence summary of the message
    - urgency: One of: low, medium, high
    - sentiment: One of: positive, neutral, negative

    Email Body:
    """
    ${body}
    """
  `;

    try {
        const response = await generateReply(
            "You are a structured data extractor. Extract all lead information accurately.",
            prompt,
            {
                model: MODELS.lead_intelligence,
                jsonMode: true,
                maxTokens: 8192
            }
        );
        const text = response.text || "";

        // Clean up response text to ensure it's valid JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to extract JSON from AI response");
        }

        const result = JSON.parse(jsonMatch[0]);
        
        // Normalize to { leads: [...] } format
        if (Array.isArray(result)) {
            return { leads: result };
        }
        if (result.leads && Array.isArray(result.leads)) {
            return result;
        }
        if (result.name || result.email) {
            return { leads: [result] };
        }
        
        return { leads: [] };
    } catch (error) {
        console.error("Error parsing email body with AI:", error);
        throw new Error("AI parsing failed: " + (error instanceof Error ? error.message : "Unknown error"));
    }
}

