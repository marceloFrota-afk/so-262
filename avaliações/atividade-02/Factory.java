/** Ponto de entrada do programa Produtor-Consumidor. */
public class Factory {
    public static void main(String[] args) {
        System.out.println("Atividade 02 - Produtor-Consumidor");
        System.out.println("Aluno: Marcelo Flávio de Carvalho Frota Porto");
        System.out.println("----------------------------------------------");

        Buffer server = new BoundedBuffer();
        Thread producerThread = new Thread(new Producer(server));
        Thread consumerThread = new Thread(new Consumer(server));

        producerThread.start();
        consumerThread.start();
    }
}
