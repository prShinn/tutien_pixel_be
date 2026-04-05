package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "players")
public class playerEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int userId;
    private statsEmbed stats;
    @Column(unique = true)
    private String name;
    @Enumerated(EnumType.STRING)
    private linhCanEnum root;
    private String canhGioi;
    private String daiCanhGioi;
    private int hp;
    private int maxHp;
    private int mp;
    private int maxMp;
    private int xu;
    private int tuVi;
    private int tuViLenCap;
    private int x; //spawn tại x
    private int y; // spawn tai y
    private int px;
    private int py;
    private trangBiEmbed trangBi;

}
