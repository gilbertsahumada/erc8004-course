/**
 * YouTube Transcription Service usando Whisper de OpenAI
 *
 * Flujo:
 * 1. Descargar audio del video de YouTube (yt-dlp)
 * 2. Audio se descarga en formato óptimo (webm, m4a, opus, etc)
 * 3. Enviar a Whisper API de OpenAI
 * 4. Retornar transcripción con timestamps
 */

import { youtubeDl } from 'youtube-dl-exec';
import { openai } from '../lib/openai.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Interfaces
// ============================================================================

interface TranscriptSegment {
    text: string;
    offset: number;
    duration: number;
}

interface VideoTranscript {
    videoId: string;
    title: string;
    channelName: string;
    transcript: string;
    segments: TranscriptSegment[];
    extractedAt: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extrae el ID del video de una URL de YouTube.
 * @param url Url video youtube
 * @returns Video ID
 */
function extractVideoId(url: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Descarga el audio de un video de YouTube y lo transcribe con Whisper
 *
 * @param videoUrl URL del video de YouTube
 * @param metadata Metadatos opcionales del video
 * @returns Transcripción del video
 */
export async function transcribe(
    videoUrl: string,
    metadata?: { title?: string; channelName?: string }
): Promise<VideoTranscript> {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
        throw new Error("Invalid YouTube URL");
    }

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const audioPath = path.join(tempDir, `${videoId}.%(ext)s`);

    // Descargar audio usando yt-dlp con deno runtime
    await youtubeDl(videoUrl, {
        format: 'bestaudio',
        output: audioPath,
        noCheckCertificates: true,
        preferFreeFormats: true,
        // @ts-ignore - opción válida de yt-dlp
        jsRuntimes: 'deno:/opt/homebrew/bin/deno',
    });

    // Buscar el archivo descargado (puede tener cualquier extensión: .webm, .m4a, .opus, etc)
    const files = fs.readdirSync(tempDir).filter(f => f.startsWith(videoId));
    if (files.length === 0) {
        throw new Error('No se pudo descargar el audio');
    }
    const downloadedAudioPath = path.join(tempDir, files[0]);

    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(downloadedAudioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
    });

    // Limpiar archivo temporal (si existe)
    if (fs.existsSync(downloadedAudioPath)) {
        fs.unlinkSync(downloadedAudioPath);
    }

    return {
        videoId,
        title: metadata?.title || 'Unknown Title',
        channelName: metadata?.channelName || 'Unknown Channel',
        transcript: transcription.text,
        segments: transcription.segments?.map(seg => ({
            text: seg.text,
            offset: seg.start,
            duration: seg.end - seg.start,
        })) || [],
        extractedAt: new Date().toISOString(),
    };
}

/**
 * Resume el contenido de un video usando la transcripción de Whisper
 *
 * @param videoUrl URL del video de YouTube
 * @returns Resumen y puntos clave
 */
export async function summarize(videoUrl: string): Promise<{
    videoId: string;
    summary: string;
    keyPoints: string[];
}> {
    const { videoId, transcript } = await transcribe(videoUrl);
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: 'You are an expert at summarizing video transcripts into concise summaries and key points.'
            },
            {
                role: 'user',
                content: `Resume this video transcript and extract key points:\n\n${transcript}
                The answer format:
                SUMMARY:
                [Your summary here]

                KEY POINTS:
                - [Key point 1]
                - [Key point 2]
                - [Key point 3]
                ...
                `
            }
        ],
        max_tokens: 500,
        temperature: 0.7,
    });

    const content = response.choices[0].message?.content || '';

    const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)\s*KEY POINTS:/);
    const pointsMatch = content.match(/KEY POINTS:\s*([\s\S]*)/);

    const summary = summaryMatch?.[1]?.trim() || content;
    const keyPoints = pointsMatch?.[1]
        ?.split(/[-•]\s+/)
        .filter((p) => p.trim())
        .map((p) => p.trim()) || [];

    return { videoId, summary, keyPoints };
}
