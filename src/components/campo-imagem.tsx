"use client";

/* eslint-disable @next/next/no-img-element -- pré-visualização local (blob:) e foto já
   salva da barbearia (/arquivos/publico/...); next/image não se aplica a nenhuma das duas. */

import { useState } from "react";
import imageCompression from "browser-image-compression";

const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];

function ehHeic(file: File) {
  const tipo = file.type.toLowerCase();
  return tipo === "image/heic" || tipo === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

// Foto do iPhone (HEIC) vira JPEG; tudo é comprimido no navegador antes de subir (logo
// e fotos são exibidos pequenos no site — 1200px/600KB sobra).
async function prepararImagem(file: File): Promise<File> {
  let origem = file;
  if (ehHeic(file)) {
    // Import dinâmico: heic2any acessa `window` no topo do módulo e quebraria o SSR.
    const { default: heic2any } = await import("heic2any");
    const convertido = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(convertido) ? convertido[0] : convertido;
    origem = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  }
  if (!TIPOS_ACEITOS.includes(origem.type)) {
    throw new Error("Formato não suportado. Envie JPG, PNG, WEBP ou foto do iPhone.");
  }
  return imageCompression(origem, { maxSizeMB: 0.6, maxWidthOrHeight: 1200, useWebWorker: true });
}

/**
 * Envia a imagem (já comprimida no navegador) para /api/arquivos — só admin grava, e o
 * servidor confere o formato pelos bytes — e coloca o caminho devolvido num input
 * escondido `name`: o formulário salva só o caminho.
 */
export function CampoImagem({
  name,
  pasta,
  urlAtual,
  rotulo,
  redonda = false,
  onEnviandoChange,
}: {
  name: string;
  pasta: string;
  urlAtual: string | null;
  rotulo: string;
  redonda?: boolean;
  onEnviandoChange?: (enviando: boolean) => void;
}) {
  const [preview, setPreview] = useState<string | null>(urlAtual);
  const [caminho, setCaminho] = useState("");
  const [status, setStatus] = useState<"idle" | "enviando" | "erro">("idle");
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("enviando");
    setErro(null);
    onEnviandoChange?.(true);
    try {
      const imagem = await prepararImagem(file);
      const corpo = new FormData();
      corpo.append("pasta", pasta);
      corpo.append("arquivo", imagem, imagem.name);
      const resposta = await fetch("/api/arquivos", { method: "POST", body: corpo });
      const dados = (await resposta.json().catch(() => ({}))) as { path?: string; erro?: string };
      if (!resposta.ok || !dados.path) throw new Error(dados.erro ?? "Não foi possível enviar a imagem.");
      setCaminho(dados.path);
      setPreview(URL.createObjectURL(imagem));
      setStatus("idle");
    } catch (err) {
      setStatus("erro");
      setErro(err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      onEnviandoChange?.(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-neutral-700">{rotulo}</span>
      <div className="flex items-center gap-3">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-neutral-300 bg-neutral-100 ${
            redonda ? "rounded-full" : "rounded-lg"
          }`}
        >
          {preview ? (
            <img src={preview} alt="" className={`h-full w-full ${redonda ? "object-cover" : "object-contain"}`} />
          ) : (
            <span className="text-xs text-neutral-400">sem</span>
          )}
        </div>
        <label className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
          {status === "enviando" ? "Enviando..." : preview ? "Trocar imagem" : "Escolher imagem"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={aoEscolher}
            disabled={status === "enviando"}
            className="hidden"
          />
        </label>
      </div>
      {caminho && <p className="mt-1 text-xs text-emerald-400">Imagem enviada — clique em Salvar para aplicar.</p>}
      {erro && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {erro}
        </p>
      )}
      <input type="hidden" name={name} value={caminho} />
    </div>
  );
}
