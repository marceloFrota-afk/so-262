const fs = require("fs");
const path = require("path");

const NOME = "Marcelo Flávio";
const PROCESSOS = ["P0", "P1", "P2", "P3", "P4"];
const TOTAL = [10, 5, 7];
const ALOCACAO_INICIAL = [
  [0, 1, 0],
  [2, 0, 0],
  [3, 0, 2],
  [2, 1, 1],
  [0, 0, 2],
];
const MAXIMO = [
  [7, 5, 3],
  [3, 2, 2],
  [9, 0, 2],
  [2, 2, 2],
  [4, 3, 3],
];

function clonar(matriz) {
  return matriz.map((linha) => [...linha]);
}

function menorOuIgual(a, b) {
  return a.every((valor, indice) => valor <= b[indice]);
}

class Banqueiro {
  constructor() {
    this.alocacao = clonar(ALOCACAO_INICIAL);
    this.maximo = clonar(MAXIMO);
    this.necessidade = this.maximo.map((linha, i) =>
      linha.map((valor, j) => valor - this.alocacao[i][j]),
    );
    this.disponivel = TOTAL.map((total, j) =>
      total - this.alocacao.reduce((soma, linha) => soma + linha[j], 0),
    );
  }

  estadoSeguro() {
    const trabalho = [...this.disponivel];
    const alocacao = clonar(this.alocacao);
    const finalizado = Array(PROCESSOS.length).fill(false);
    const sequencia = [];

    while (sequencia.length < PROCESSOS.length) {
      let encontrou = false;
      for (let i = 0; i < PROCESSOS.length; i += 1) {
        if (!finalizado[i] && menorOuIgual(this.necessidade[i], trabalho)) {
          alocacao[i].forEach((valor, j) => {
            trabalho[j] += valor;
          });
          finalizado[i] = true;
          sequencia.push(PROCESSOS[i]);
          encontrou = true;
          break;
        }
      }
      if (!encontrou) {
        return { seguro: false, sequencia: [] };
      }
    }

    return { seguro: true, sequencia };
  }

  solicitar(indice, pedido) {
    const necessidadeAntes = [...this.necessidade[indice]];
    if (!menorOuIgual(pedido, necessidadeAntes)) {
      return {
        resultado: "NEGADA",
        motivo: "A solicitação excede a necessidade máxima declarada.",
      };
    }

    if (!menorOuIgual(pedido, this.disponivel)) {
      return {
        resultado: "BLOQUEADA",
        motivo: "Não há recursos disponíveis suficientes neste momento.",
      };
    }

    pedido.forEach((valor, j) => {
      this.disponivel[j] -= valor;
      this.alocacao[indice][j] += valor;
      this.necessidade[indice][j] -= valor;
    });

    const verificacao = this.estadoSeguro();
    if (verificacao.seguro) {
      return {
        resultado: "CONCEDIDA",
        motivo: `O estado resultante permanece seguro (${verificacao.sequencia.join(" -> ")}).`,
      };
    }

    pedido.forEach((valor, j) => {
      this.disponivel[j] += valor;
      this.alocacao[indice][j] -= valor;
      this.necessidade[indice][j] += valor;
    });
    return {
      resultado: "NEGADA",
      motivo: "A solicitação levaria o sistema a um estado inseguro; rollback realizado.",
    };
  }
}

function linhasDoEstado(banqueiro) {
  return [
    `Recursos totais (E): ${JSON.stringify(TOTAL)}`,
    `Recursos disponíveis (A): ${JSON.stringify(banqueiro.disponivel)}`,
    `Necessidades (Need): ${JSON.stringify(banqueiro.necessidade)}`,
  ];
}

const testes = [
  {
    arquivo: "teste-01-estado-seguro",
    titulo: "Teste 1 - Estado inicial seguro",
    explicacao:
      "Verifica se a configuração inicial permite que todos os processos terminem sem deadlock.",
    executar(b) {
      const resultado = b.estadoSeguro();
      return [
        `Estado seguro: ${resultado.seguro ? "SIM" : "NÃO"}`,
        `Sequência segura: ${resultado.sequencia.join(" -> ")}`,
      ];
    },
  },
  {
    arquivo: "teste-02-solicitacao-segura",
    titulo: "Teste 2 - Solicitação segura concedida",
    explicacao:
      "P1 solicita [1, 0, 2]. O pedido está dentro da sua necessidade e mantém o sistema seguro.",
    executar(b) {
      const resultado = b.solicitar(1, [1, 0, 2]);
      return [`Processo: P1`, `Pedido: [1, 0, 2]`, `Resultado: ${resultado.resultado}`, `Motivo: ${resultado.motivo}`];
    },
  },
  {
    arquivo: "teste-03-solicitacao-acima-da-necessidade",
    titulo: "Teste 3 - Solicitação acima da necessidade",
    explicacao:
      "P0 solicita [8, 0, 0], mas sua necessidade restante é [7, 4, 3]. O algoritmo deve negar o pedido imediatamente.",
    executar(b) {
      const resultado = b.solicitar(0, [8, 0, 0]);
      return [`Processo: P0`, `Pedido: [8, 0, 0]`, `Resultado: ${resultado.resultado}`, `Motivo: ${resultado.motivo}`];
    },
  },
  {
    arquivo: "teste-04-solicitacao-bloqueada",
    titulo: "Teste 4 - Solicitação bloqueada por falta de recurso",
    explicacao:
      "P2 solicita [4, 0, 0]. O pedido é válido, mas só existem 3 unidades de R0 disponíveis; por isso, P2 deve aguardar.",
    executar(b) {
      const resultado = b.solicitar(2, [4, 0, 0]);
      return [`Processo: P2`, `Pedido: [4, 0, 0]`, `Resultado: ${resultado.resultado}`, `Motivo: ${resultado.motivo}`];
    },
  },
  {
    arquivo: "teste-05-rollback-estado-inseguro",
    titulo: "Teste 5 - Solicitação que causaria estado inseguro",
    explicacao:
      "P0 solicita [0, 0, 2]. O pedido cabe nos recursos disponíveis, mas a simulação mostra que o estado resultante não é seguro; o algoritmo desfaz a alocação.",
    executar(b) {
      const resultado = b.solicitar(0, [0, 0, 2]);
      return [
        `Processo: P0`,
        `Pedido: [0, 0, 2]`,
        `Resultado: ${resultado.resultado}`,
        `Motivo: ${resultado.motivo}`,
        `Disponível após a decisão: ${JSON.stringify(b.disponivel)}`,
      ];
    },
  },
];

function escaparSvg(texto) {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function gerarSvg(titulo, linhas) {
  const altura = 170 + linhas.length * 24;
  const texto = linhas
    .map(
      (linha, i) =>
        `<text x="35" y="${150 + i * 24}" fill="#f8fafc" font-family="Consolas, monospace" font-size="16">${escaparSvg(linha)}</text>`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${altura}" viewBox="0 0 1000 ${altura}">
<rect width="100%" height="100%" fill="#111827"/>
<text x="35" y="40" fill="#93c5fd" font-family="Arial, sans-serif" font-size="23" font-weight="bold">${escaparSvg(NOME)}</text>
<text x="35" y="78" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="20">${escaparSvg(titulo)}</text>
<line x1="35" y1="98" x2="965" y2="98" stroke="#64748b"/>
${texto}
</svg>`;
}

const pastaEvidencias = path.join(__dirname, "evidencias");
fs.mkdirSync(pastaEvidencias, { recursive: true });

for (const teste of testes) {
  const banqueiro = new Banqueiro();
  const linhas = [
    `Aluno: ${NOME}`,
    `Teste: ${teste.titulo}`,
    ...linhasDoEstado(banqueiro),
    ...teste.executar(banqueiro),
  ];
  const saida = `${linhas.join("\n")}\n`;
  fs.writeFileSync(path.join(pastaEvidencias, `${teste.arquivo}.txt`), saida);
  fs.writeFileSync(
    path.join(pastaEvidencias, `${teste.arquivo}.svg`),
    gerarSvg(teste.titulo, linhas),
  );
  console.log(saida);
}
