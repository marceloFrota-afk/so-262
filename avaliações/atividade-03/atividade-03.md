# ESPECIFICAÇÃO DE PROJETO: GERENCIADOR DE PROCESSOS EM SIMULADOR DE SISTEMA OPERACIONAL

**Documento de Requisitos e Arquitetura para Implementação em Modo Usuário**  
*Destinado à Engenharia de Software e Síntese via Agentes Autônomos (Claude Code, Open Code)*

---

## 1. Visão Geral e Contexto do Simulador

### 1.1 Objetivo e Escopo
O objetivo deste projeto é construir um **simulador de núcleo de sistema operacional em modo usuário**, focado no gerenciamento de processos, controle de estados de execução e políticas de escalonamento de CPU mononúcleo.

O simulador modela a ilusão de pseudoparalelismo através da multiprogramação, onde uma única CPU virtual chaveia dinamicamente entre múltiplos fluxos de controle sequenciais independentes, preservando e restaurando o contexto de execução de cada processo.

### 1.2 Premissas Operacionais
- **Ambiente de Execução:** Aplicação de console em espaço de usuário (POSIX/C11 ou C++17).
- **Abstração de Hardware:** Não há interação direta com registradores físicos de hardware; a máquina virtual hospeda estruturas de dados puras que emulam o ciclo de instrução e o vetor de interrupção.
- **Determinismo e Relógio Discreto:** O tempo é regido por um relógio lógico de passos discretos (*ticks*), eliminando condições de corrida não determinísticas do ambiente hospedeiro e garantindo reprodutibilidade estrita para testes automatizados.

---

## 2. Estrutura do Hardware Simulado e Ciclo de Execução

### 2.1 Componentes do Hardware Simulado
O hardware simulado é composto pelas seguintes abstrações:

1. **CPU Virtual:**
   - `PC` (*Program Counter* / Contador de Programa): Registrador lógico que aponta para a próxima operação ou surto da tarefa.
   - `SP` (*Stack Pointer* / Ponteiro de Pilha): Valor fictício para rastreamento da pilha de execução.
   - Registradores de Uso Geral (`R0`, `R1`, `R2`, `R3`): Armazenam valores inteiros associados à computação do processo corrente.
   - `FLAGS` (Registrador de Estado / PSW simplificado): Registrador que reflete flags aritméticas e modo de operação.
2. **Relógio Lógico (*Clock*):**
   - Contador incremental `uint64_t g_system_time` avançado a cada tique elementar de simulação.
   - Gera eventos periódicos de interrupção de relógio (*timer interrupt*) ao término de cada quantum do escalonador.
3. **Dispositivo Fictício de Entrada/Saída (I/O Subsystem):**
   - Controladora com fila de espera para processos bloqueados em operações de disco/rede.
   - Contador de tempo de serviço de E/S restante para cada processo pendente.

### 2.2 Ciclo de Execução Principal (*Engine Loop*)
A cada *tick* do relógio lógico, o motor do simulador executa o seguinte pipeline:

```
+-------------------------------------------------------------------+
| 1. Atualizar I/O: Decrementar temporizadores de processos em I/O  |
|    - Se E/S concluiu: Mover processo de BLOQUEADO -> PRONTO       |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 2. Checar Chegada de Novos Processos (do arquivo de tarefas)     |
|    - Se arrival_time == current_tick: Instanciar PCB e PRONTO     |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 3. Chamar Escalonador se CPU ociosa ou se preempção foi acionada  |
|    - Troca de contexto: salvar CPU no PCB antigo, restaurar novo  |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 4. Executar 1 Ciclo do Processo Corrente (Running)                |
|    - Consumir 1 unidade de surto de CPU                           |
|    - Atualizar métricas (cpu_time_spent, quantum_remaining)       |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 5. Avaliar Condição de Saída do Ciclo Corrente:                   |
|    a) Terminou o surto total da tarefa? -> EXIT (TERMINATED)      |
|    b) Solicitou E/S?                    -> BLOCK (I/O WAIT)       |
|    c) Quantum expirou?                  -> TIMER INTERRUPT (READY)|
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 6. Incrementar g_system_time e registrar logs / Gantt             |
+-------------------------------------------------------------------+
```

---

## 3. Especificação do PCB e Tabela de Processos

### 3.1 Definição da Estrutura `ProcessControlBlock` (PCB)
O Bloco de Controle de Processo (PCB) é a estrutura fundamental que armazena todas as informações de estado e recursos necessários para retomar a execução do processo a qualquer momento.

```c
#ifndef PCB_H
#define PCB_H

#include <stdint.h>
#include <stdbool.h>

#define MAX_OP_BURSTS 64

// Estados clássicos do ciclo de vida
typedef enum {
    PROCESS_STATE_NEW,
    PROCESS_STATE_READY,
    PROCESS_STATE_RUNNING,
    PROCESS_STATE_BLOCKED,
    PROCESS_STATE_TERMINATED
} ProcessState;

// Tipo de operação na sequência de execução da tarefa
typedef enum {
    BURST_CPU,
    BURST_IO
} BurstType;

typedef struct {
    BurstType type;
    uint32_t duration;
} Burst;

// Registradores de contexto de hardware simulados
typedef struct {
    uint32_t pc;
    uint32_t sp;
    uint32_t r[4];       // R0, R1, R2, R3
    uint32_t flags;
} CpuContext;

// Estrutura principal do PCB
typedef struct ProcessControlBlock {
    // Identificação
    uint32_t pid;
    uint32_t ppid;

    // Estado e Hardware
    ProcessState state;
    CpuContext context;

    // Escalonamento e Prioridades
    uint32_t static_priority;   // Prioridade base definida na carga (0 a 100)
    uint32_t current_priority;  // Prioridade dinâmica ajustada por aging
    uint32_t current_quantum_used;

    // Surtos de Execução da Tarefa
    Burst bursts[MAX_OP_BURSTS];
    uint32_t total_bursts;
    uint32_t current_burst_index;
    uint32_t current_burst_remaining;

    // Estatísticas e Métricas Temporais
    uint64_t arrival_time;
    uint64_t start_time;        // Primeiro momento em que assumiu a CPU
    uint64_t exit_time;         // Momento de conclusão (exit)
    uint64_t total_cpu_time;    // Tempo total de CPU gasto
    uint64_t total_wait_time;   // Tempo total aguardando na fila de prontos
    uint64_t total_io_time;     // Tempo total retido em fila de E/S

    // Rastreamento para prevenção de inanição (Aging)
    uint64_t last_ready_enqueue_time;
    uint64_t accumulated_ready_starvation_ticks;

    // Encadeamento para listas intrusivas (opcional)
    struct ProcessControlBlock* next;
} ProcessControlBlock;

#endif // PCB_H
```

### 3.2 Tabela de Processos (*Process Table*)
A Tabela de Processos mantém o registro ativo de todos os processos gerenciados pelo núcleo simulado:
- **Formato:** Vetor estático de ponteiros `ProcessControlBlock* process_table[MAX_PROCESSES]` com busca indexada por `PID`.
- **Capacidade Recomendada:** `MAX_PROCESSES = 256`.
- **Filas de Gerenciamento do Núcleo:**
  - `ReadyQueue`: Fila de processos no estado `PROCESS_STATE_READY`.
  - `BlockedQueue`: Lista de processos no estado `PROCESS_STATE_BLOCKED`.
  - `TerminatedList`: Lista de processos encerrados mantidos para auditoria e cálculo de métricas finais.

---

## 4. Ciclo de Vida e Grafo de Transição de Estados

### 4.1 Modelagem dos Três Estados Clássicos
1. **Pronto (*Ready*):** O processo possui todos os recursos necessários e está apto a executar; aguarda apenas a CPU ser alocada pelo escalonador.
2. **Em Execução (*Running*):** O processo detém a posse da CPU virtual e suas instruções/surtos de processamento estão sendo consumidos.
3. **Bloqueado (*Blocked*):** O processo não pode computar no momento porque iniciou uma solicitação de E/S fictícia e aguarda o término do evento externo correspondente.

### 4.2 Grafo de Transições

```
                   +-------------------+
                   |   NEW (Criação)   |
                   +-------------------+
                             |
                             | [1] Criação / fork / chegada
                             v
+------------------->+-------------------+<---------------------+
|                    |      PRONTO       |                      |
|                    |      (Ready)      |                      |
|                    +-------------------+                      |
|                              |                                |
|                              | [2] Despacho (Dispatch)        |
| [4] Preempção de Quantum     v                                | [5] Conclusão de E/S
|     (Timer Interrupt)   +-------------------+                 |     (I/O Completed)
+-------------------------|   EM EXECUÇÃO     |                 |
                          |     (Running)     |                 |
                          +-------------------+                 |
                             |             |                    |
       [3] Bloqueio por E/S  |             | [6] Término (exit) |
           (I/O Request)     v             v                    |
                   +-------------------+  +-------------------+ |
                   |     BLOQUEADO     |  |     TERMINADO     | |
                   |     (Blocked)     |  |   (Terminated)    | |
                   +-------------------+  +-------------------+ |
                             |                                  |
                             +----------------------------------+
```

### 4.3 Especificação Funcional de Cada Transição

1. **Transição 1: Criação de Processo (`NEW -> READY`)**
   - **Gatilho:** Início de tarefa programada ou chamada de sistema fictícia `sys_fork()`.
   - **Ação:** Alocar PCB, atribuir `PID` único, clonar contexto se for `fork` ou carregar vetor de surtos da tarefa, registrar `arrival_time = g_system_time`, mudar estado para `READY` e inserir na `ReadyQueue`.
2. **Transição 2: Despacho do Escalonador (`READY -> RUNNING`)**
   - **Gatilho:** CPU ociosa ou preempção que determinou novo processo a ser atendido.
   - **Ação:** Escalonador remove o PCB eleito da `ReadyQueue`, altera estado para `RUNNING`, restaura contexto nos registradores da CPU, reinicia o temporizador de fatia de tempo (`quantum_remaining = QUANTUM`) e atualiza tempo de espera acumulado.
3. **Transição 3: Solicitação de E/S (`RUNNING -> BLOCKED`)**
   - **Gatilho:** O surto de CPU corrente foi concluído e a próxima operação do processo é `BURST_IO`.
   - **Ação:** Salvar registradores no PCB, mudar estado para `BLOCKED`, carregar `current_burst_remaining` com a duração da E/S, mover o PCB da CPU para a `BlockedQueue` e invocar imediatamente o escalonador.
4. **Transição 4: Expiração do Quantum (`RUNNING -> READY`)**
   - **Gatilho:** Interrupção periódica de relógio após o processo atingir a cota máxima de tempo ininterrupto (`quantum_remaining == 0`) com surto de CPU ainda pendente.
   - **Ação:** Salvar registradores da CPU no PCB, alterar estado para `READY`, recolocar o processo no fim da fila de prontos apropriada e invocar o escalonador.
5. **Transição 5: Conclusão de E/S (`BLOCKED -> READY`)**
   - **Gatilho:** O dispositivo de E/S fictício decrementou o tempo restante de E/S até zero (`current_burst_remaining == 0`).
   - **Ação:** Mover PCB da `BlockedQueue` para a `ReadyQueue`, avançar `current_burst_index` para o próximo surto de CPU, mudar estado para `READY`. Pode acionar preempção imediata caso a política de prioridades determine.
6. **Transição 6: Término do Processo (`RUNNING -> TERMINATED`)**
   - **Gatilho:** Todos os surtos de CPU e E/S foram esgotados (equivalente à chamada `sys_exit()`).
   - **Ação:** Mudar estado para `TERMINATED`, registrar `exit_time = g_system_time`, calcular métricas finais do processo (turnaround, total de espera, total de CPU), liberar a CPU virtual e acionar o escalonador.

---

## 5. Especificação do Escalonador de CPU

O escalonador deve ser implementado de forma modular e desacoplada da CPU, utilizando a interface abstrata abaixo:

```c
typedef struct Scheduler {
    const char* name;
    void (*init)(void);
    void (*enqueue_ready)(ProcessControlBlock* pcb);
    ProcessControlBlock* (*pick_next)(void);
    void (*tick)(ProcessControlBlock* running_pcb);
    void (*on_burst_completed)(ProcessControlBlock* pcb);
} Scheduler;
```

### 5.1 Algoritmo 1: Escalonamento Circular (*Round Robin - RR*)
- **Estrutura de Fila:** Fila FIFO clássica mantida através de ponteiros ou arranjo circular.
- **Parâmetro Configurável:** `QUANTUM` (valor padrão sugerido: 4 *ticks*).
- **Regras Operacionais:**
  1. Novos processos e processos desbloqueados de E/S são inseridos no final da fila (`tail`).
  2. O despachante retira o processo na cabeça da fila (`head`).
  3. A cada tique em que o processo executa, seu contador de fatia é decrementado.
  4. Se o processo esgotar o quantum e ainda possuir trabalho de CPU a realizar:
     - Ocorre preempção (*timer interrupt*).
     - O processo é desalocado da CPU e colocado no final da fila de prontos.
  5. Se o processo bloquear voluntariamente por E/S ou terminar antes de findar o quantum, a fatia restante é descartada e o próximo processo da fila é imediatamente escalonado.

### 5.2 Algoritmo 2: Escalonamento por Prioridades com Prevenção de Inanição (*Aging*)
- **Estrutura:** Múltiplas filas de prioridade (níveis de 0 a 3, onde 3 representa a prioridade mais alta) ou Fila de Prioridade Ordenada por `current_priority`.
- **Preempção:** Preemptivo por prioridade (se um processo de prioridade maior ficar pronto, o processo corrente de prioridade menor sofre preempção).
- **Mecanismo de Prevenção de Inanição (*Aging* / Envelhecimento):**
  - **Problema:** Em um sistema puramente por prioridade estática, se processos de alta prioridade chegarem continuamente, processos de menor prioridade podem sofrer inanição (*starvation*), permanecendo indefinidamente sem tempo de CPU.
  - **Mecanismo Anti-Inanição:**
    - A cada `AGING_INTERVAL` ticks (ex: a cada 8 *ticks*) que um processo passa no estado `READY` sem receber a CPU, sua prioridade dinâmica `current_priority` é incrementada em 1 nível, até o teto máximo permitido.
    - Quando o processo envelhecido é finalmente escolhido e executa por 1 quantum completo, sua prioridade dinâmica é restaurada para a prioridade base `static_priority`.

---

## 6. Formato de Arquivos de Entrada e Casos de Teste

### 6.1 Sintaxe do Arquivo de Tarefas (`tasks.txt`)
O arquivo de entrada define os processos que entrarão no simulador. Linhas iniciadas por `#` são comentários.

**Formato da linha:**
```
PID;ARRIVAL_TIME;PRIORITY;BURST_TYPE:DURATION,BURST_TYPE:DURATION,...
```
Onde:
- `PID`: Identificador único (inteiro positivo).
- `ARRIVAL_TIME`: Tique do relógio no qual o processo é submetido.
- `PRIORITY`: Prioridade estática base (inteiro de 0 a 3).
- Sequência de Surtos: Pares separados por vírgula (`C` para CPU, `I` para I/O) com suas respectivas durações em *ticks*.

**Exemplo de `tasks.txt`:**
```text
# Arquivo de Tarefas para Simulação de Núcleo
# PID;Chegada;Prioridade;Surtos(C=CPU, I=IO)
1;0;2;C:6,I:4,C:4
2;2;3;C:3,I:2,C:2
3;4;1;C:8
4;6;0;C:10
```

---

## 7. Saídas Obrigatórias do Simulador

O simulador deve gerar três fluxos de saída claros e verificáveis:

### 7.1 Log de Transições de Estado
Registro detalhado em console ou arquivo `trace.log` de cada transição de estado:
```text
[Tick 000] Processo 1 criado. Estado: NEW -> READY (Prioridade: 2)
[Tick 000] CPU Despachada para Processo 1. Estado: READY -> RUNNING
[Tick 002] Processo 2 criado. Estado: NEW -> READY (Prioridade: 3)
[Tick 004] TIMER_INTERRUPT: Quantum expirado para PID 1. RUNNING -> READY
[Tick 004] CPU Despachada para Processo 2. Estado: READY -> RUNNING
[Tick 007] IO_REQUEST: Processo 2 solicitou I/O de 2 ticks. RUNNING -> BLOCKED
...
```

### 7.2 Gráfico de Gantt Textual
Exibição gráfica simples em texto representando a alocação da CPU por intervalo de tiques:
```text
=== GRÁFICO DE GANTT (CPU) ===
[00-04] | PID 1 |
[04-07] | PID 2 |
[07-09] | PID 1 |
[09-11] | PID 2 |
[11-13] | PID 1 |
[13-21] | PID 3 |
[21-31] | PID 4 |
```

### 7.3 Relatório Final de Métricas e Desempenho
Estatísticas globais e individuais calculadas ao final da execução:
```text
======================= RELATÓRIO DE DESEMPENHO DO NÚCLEO =======================
PID   Chegada  Término   Turnaround   Tempo CPU   Tempo Espera   Tempo I/O
---------------------------------------------------------------------------------
 1       0        13          13          10            0             3
 2       2        11           9           5            2             2
 3       4        21          17           8            9             0
 4       6        31          25          10           15             0
---------------------------------------------------------------------------------
Tempo Total de Simulação: 31 ticks
Vazão (Throughput):       0.129 processos/tick
Tempo Médio de Retorno:   16.00 ticks
Tempo Médio de Espera:    6.50 ticks
Utilização da CPU:        100.00% (0 ticks ociosos)
=================================================================================
```

---

## 8. Diretrizes de Arquitetura e Implementação para o Harness

Ao submeter esta especificação para agentes autônomos de desenvolvimento de software (como **Claude Code** ou **Open Code**), deve-se adotar a seguinte estrutura modular:

```text
simulator/
├── Makefile                 # Regras de compilação com flags: -Wall -Wextra -pedantic -std=c11
├── include/
│   ├── cpu.h                # Estruturas da CPU virtual e registradores
│   ├── pcb.h                # Declaração do PCB e enums de estado
│   ├── process_table.h      # Manipulação da tabela de processos e filas
│   ├── scheduler.h          # Interface genérica do escalonador
│   ├── scheduler_rr.h       # Implementação Round Robin
│   ├── scheduler_priority.h # Implementação Prioridades com Aging
│   ├── io_system.h          # Gerenciamento de filas e contadores de E/S
│   └── metrics.h            # Coleta de tempos e gerador de Gantt
├── src/
│   ├── main.c               # Loop de eventos e parsing de argumentos
│   ├── cpu.c                # Lógica de ciclo de instrução e troca de contexto
│   ├── pcb.c                # Alocação, liberação e transição de PCBs
│   ├── process_table.c      # Operações de inserção e remoção em filas
│   ├── scheduler_rr.c       # Algoritmo Round Robin
│   ├── scheduler_priority.c # Algoritmo Prioridades com Envelhecimento
│   ├── io_system.c          # Atualização de surtos de E/S
│   └── metrics.c            # Impressão de logs e tabela estatística
└── tests/
    ├── test_rr.txt          # Cenário de teste 1: Concorrência CPU-bound sob Round Robin
    ├── test_io_bound.txt    # Cenário de teste 2: Intercalação pesada de CPU e E/S
    ├── test_aging.txt       # Cenário de teste 3: Validação de prevenção de inanição
    └── run_tests.sh         # Script de testes de regressão automatizados
```

### 8.1 Requisitos de Robustez e Tolerância a Falhas
1. **Sem Vazamento de Memória:** Toda estrutura alocada para os PCBs deve ser devidamente liberada ao término do programa (validado com `valgrind --leak-check=full`).
2. **Determinismo:** A ordem de desempate para processos com a mesma prioridade deve seguir estritamente a ordem de chegada (FIFO).
3. **Desacoplamento:** A troca entre os escalonadores Round Robin e Prioridades deve ser feita via parâmetro de linha de comando (ex: `./simulator -s rr -q 4 tasks.txt` ou `./simulator -s priority -a 8 tasks.txt`).
